const express = require('express');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { createCanvas, registerFont } = require('canvas');
const sharp = require('sharp');

// Logs könyvtár létrehozása, ha nem létezik (LOG_DIR felülírható, pl. read-only rootfs + tmpfs esetén)
const logsDir = process.env.LOG_DIR || path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Fejlesztői mód jelző
const isDev = process.env.NODE_ENV !== 'production';

// Naplózó függvény
function log(type, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logData = {
        timestamp,
        type,
        message,
        ...data
    };

    // Fejlesztői módban minden adat megtartása hibakereséshez
    if (!isDev) {
        // Érzékeny információk elrejtése produkciós környezetben
        if (logData.name) logData.name = 'REDACTED';
        if (logData.identifier) logData.identifier = 'REDACTED';
        if (logData.error?.stack) delete logData.error.stack;
    }

    // Napló bejegyzés formázása
    const logEntry = JSON.stringify(logData) + '\n';
    try {
        fs.appendFileSync(path.join(logsDir, isDev ? 'debug.log' : 'app.log'), logEntry);
    } catch (err) {
        // A naplózás hibája soha ne döntse le a kérést
        if (isDev) console.error('Log írás sikertelen:', err.message);
    }

    // Fejlesztői módban konzolra is naplózás hibakereséshez
    if (isDev) {
        console.log(`[${type.toUpperCase()}] ${message}`, data);
    }
}

// Debug naplózó - csak fejlesztői módban naplóz
function debug(message, data = {}) {
    if (isDev) {
        log('debug', message, data);
    }
}

// Feldolgozható PDF korlátok (erőforrás-védelem)
const MAX_PDF_PAGES = 50;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

// PDF szövegkinyerés a karbantartott pdf.js (pdfjs-dist) könyvtárral.
// Az isEvalSupported: false letiltja a PDF-be ágyazott tartalom dinamikus kódgenerálását
// (a régi pdf-parse 1.1.1 beágyazott pdf.js 1.10.100-át használt, ami érintett a CVE-2024-4367 osztályban).
const PDFJS_MODULE = 'pdfjs-dist/legacy/build/pdf.mjs';
let pdfjsLibPromise = null;

function getPdfjs() {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = import(PDFJS_MODULE);
    }
    return pdfjsLibPromise;
}

async function extractPdfText(dataBuffer, maxPages = MAX_PDF_PAGES) {
    const pdfjs = await getPdfjs();
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(dataBuffer),
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        isOffscreenCanvasSupported: false,
        verbosity: 0
    });

    const doc = await loadingTask.promise;
    const numpages = doc.numPages;
    let text = '';

    try {
        const limit = Math.min(numpages, maxPages);
        for (let i = 1; i <= limit; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent({
                normalizeWhitespace: false,
                disableCombineTextItems: false
            });

            let lastY;
            for (const item of content.items) {
                // A jelölt tartalom (marked content) elemeknek nincs str mezőjük
                if (typeof item.str !== 'string') continue;
                if (lastY === item.transform[5] || lastY === undefined) {
                    text += item.str;
                } else {
                    text += '\n' + item.str;
                }
                lastY = item.transform[5];
            }
            text += '\n';
            page.cleanup();
        }
    } finally {
        await loadingTask.destroy();
    }

    return { text, numpages };
}

// Szabványos bankkártya méretek 300 DPI felbontásnál
const CARD_WIDTH = 1050;  // 89mm 300 DPI-nél
const CARD_HEIGHT = 600;  // 51mm 300 DPI-nél
const QR_SIZE = 250;      // QR kód mérete pixelben
const MARGIN = 50;        // Margó pixelben

const app = express();
const port = process.env.PORT || 3000;

// Multer konfigurálása fájl feltöltésekhez
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 1,
        fields: 20
    },
    // Csak PDF feltöltést fogadunk el
    fileFilter: (req, file, cb) => {
        const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
        if (!isPdf) {
            return cb(new Error('Only PDF files are allowed'));
        }
        cb(null, true);
    }
});

// Middleware-ek
app.disable('x-powered-by');

// Biztonsági fejlécek (a Traefik/Cloudflare fejlécek mellett is érvényesek)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // A QR-beolvasó a böngésző kameráját használja, ezért a kamerát engedjük (self)
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
    next();
});

app.use(bodyParser.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));

// Egészségügyi végpont (Docker healthcheck / külső monitorozás) - nem ír naplót és nem számol sokat
app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// API végpont QR kód generáláshoz
app.post('/generate', async (req, res) => {
    try {
        const { text, displayText } = req.body;
        if (typeof text !== 'string' || !text.trim()) {
            log('warn', 'QR code generation failed - missing text');
            return res.status(400).json({ error: 'Text is required' });
        }
        // Bemeneti hossz korlát: túl nagy bemenet felesleges CPU/memória terhelés
        if (text.length > 2000 || (displayText && String(displayText).length > 300)) {
            log('warn', 'QR code generation failed - input too long');
            return res.status(413).json({ error: 'Text is too long' });
        }

        // Generate QR code with larger canvas for text
        const qrSize = 300;
        const canvasHeight = displayText ? 400 : 350;
        const canvas = createCanvas(350, canvasHeight);
        const ctx = canvas.getContext('2d');

// Fehér háttér beállítása
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

// QR kód generálása
        const qrCodeDataUrl = await QRCode.toDataURL(text, {
            width: qrSize,
            margin: 0,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });

// QR kód betöltése és rajzolása
        const qrImage = await loadImage(qrCodeDataUrl);
        ctx.drawImage(qrImage, 25, 25, qrSize, qrSize);

// Szöveg hozzáadása, ha meg van adva
        if (displayText) {
            ctx.font = 'bold 16px Arial';
            ctx.fillStyle = '#000000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

// Szöveg tördelése
            const maxWidth = 300;
            const lineHeight = 20;
            const startY = qrSize + 40;

            const words = displayText.split(' ');
            let line = '';
            let y = startY;

            for (const word of words) {
                const testLine = line + (line ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width > maxWidth && line !== '') {
                    ctx.fillText(line, canvas.width / 2, y);
                    line = word;
                    y += lineHeight;
                } else {
                    line = testLine;
                }
            }
            if (line) {
                ctx.fillText(line, canvas.width / 2, y);
            }
        }

// Base64 konvertálás
        const qrCodeWithText = canvas.toDataURL('image/png');
        log('info', 'QR code generated successfully with text');
        res.json({ qrCode: qrCodeWithText });
    } catch (error) {
        log('error', 'QR code generation failed', { error });
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Főoldal kiszolgálása
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// PDF feldolgozása és adatok kinyerése
app.post('/process-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            log('warn', 'PDF processing failed - no file uploaded');
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const dataBuffer = req.file.buffer;
        if (dataBuffer.length > MAX_PDF_BYTES) {
            log('warn', 'PDF processing failed - file too large');
            return res.status(413).json({ error: 'File too large (max 5MB)' });
        }

        // Legfeljebb MAX_PDF_PAGES oldal feldolgozása (a dokumentumok 1-2 oldalasak) - erőforrás-korlát
        const pdfData = await extractPdfText(dataBuffer);
        
        // Szöveges tartalom kinyerése
        const text = pdfData.text;
        debug('Raw PDF content', { text });
        log('info', 'PDF parsed successfully');

        // Kinyert adatok inicializálása
        const extractedData = {
            name: "",
            identifier: "",
            employmentType: "",
            contractType: "",
            projectName: "",
            companyName: "",
            companyId: "",
            qrCodeId: ""
        };

        // Szöveg sorokra bontása és feldolgozása
        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
        debug('Processed lines', { lineCount: lines.length, lines });
        
        for (const line of lines) {
            // Tartalom azonosítása minták alapján
            const cleanedLine = line.trim().replace(/\s+/g, ' ');
            debug('Processing line', { original: line, cleaned: cleanedLine });

            // Mezők feldolgozása
            processName(cleanedLine, extractedData) && debug('Name found', { name: extractedData.name });
            processIdentifier(cleanedLine, extractedData) && debug('Identifier found', { identifier: extractedData.identifier });
            processEmploymentType(cleanedLine, extractedData) && debug('Employment type found', { type: extractedData.employmentType });
            processContractType(cleanedLine, extractedData) && debug('Contract type found', { type: extractedData.contractType });
            processCompany(cleanedLine, extractedData) && debug('Company found', { company: extractedData.companyName, id: extractedData.companyId });
            processProjectName(cleanedLine, lines, extractedData) && debug('Project name found', { project: extractedData.projectName });
            processQRCode(cleanedLine, extractedData) && debug('QR code found', { qrCode: extractedData.qrCodeId });
        }

        log('info', 'Data extracted successfully', { 
            hasName: !!extractedData.name,
            hasIdentifier: !!extractedData.identifier,
            hasCompany: !!extractedData.companyName
        });

        res.json(extractedData);
    } catch (error) {
        log('error', 'PDF processing failed', { error });
        res.status(500).json({ error: 'Failed to process PDF' });
    }
});

// Mező feldolgozó függvények
function processName(line, data) {
    if (data.name) return false;
    
    const normalizedName = line.replace(/\s+/g, ' ').trim();
    const namePattern = /^(?:(?:Dr\.|Dr)\s+)?(?:[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:né)?(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)*)+$/;
    
    if (namePattern.test(normalizedName) && 
        !normalizedName.includes('KFT') && 
        !normalizedName.includes('ZRT') &&
        normalizedName !== data.employmentType) {
        data.name = normalizedName;
        return true;
    }
}

function processIdentifier(line, data) {
    if (data.identifier) return false;
    if (/^\d{10}$/.test(line)) {
        data.identifier = line;
        return true;
    }
    return false;
}

function processEmploymentType(line, data) {
    if (data.employmentType) return false;
    
    // Kihagyás, ha a sor azonosító vagy név
    if (line === data.identifier || line === data.name) {
        return false;
    }
    
    // Név és azonosító után kell lennie, de nem lehet szerződés típus
    if (data.name && 
        data.identifier && 
        !line.toLowerCase().includes('viszony') &&
        line.length > 0) {
        data.employmentType = line;
        return true;
    }
    return false;
}

function processContractType(line, data) {
    if (data.contractType) return false;
    if (line.toLowerCase().includes('viszony')) {
        data.contractType = line;
        return true;
    }
    return false;
}

function processCompany(line, data) {
    if (data.companyName) return false;
    
    const companyPattern = /(?:")?([^"]+?)(?:")?\s*(KFT|ZRT|BT|KKT|NYRT|E\.V\.|LTD|CO|ZÁRTKÖRŰEN\s+MŰKÖDŐ\s+RÉSZVÉNYTÁRSASÁG)\.?\s*-\s*(\d+)/i;
    const match = line.match(companyPattern);
    
    if (match) {
        const hasQuotes = line.includes('"');
        const companyName = hasQuotes ? `"${match[1]}"` : match[1];
        const companyType = match[2].toUpperCase() === 'ZÁRTKÖRŰEN MŰKÖDŐ RÉSZVÉNYTÁRSASÁG' ? 'ZRT' : match[2].toUpperCase();
        data.companyName = `${companyName} ${companyType}`;
        data.companyId = match[3];
        return true;
    }
}

function processProjectName(line, lines, data) {
    if (data.projectName) return false;
    
    // Projekt sor indexének keresése
    const projectLineIndex = lines.findIndex(l => {
        const cleanedLine = l.trim().replace(/\s+/g, ' ');
        return /\d+\s*út\/vonalszám|\d+\s*[úu]t/.test(cleanedLine);
    });

    if (projectLineIndex >= 0) {
        debug('Found project line', { line: lines[projectLineIndex] });
        
        // Projekt sorok gyűjtése
        const projectLines = [lines[projectLineIndex]];
        
        // További helyszín sorok keresése
        for (let i = projectLineIndex + 1; i < lines.length; i++) {
            const nextLine = lines[i].trim();
            debug('Checking next line', { nextLine });
            
            // Megállás, ha ezek közül bármelyiket találjuk
            if (nextLine.includes('KFT') || 
                nextLine.includes('ZRT') || 
                nextLine.includes('BT') || 
                nextLine.includes('KKT') || 
                nextLine.includes('NYRT') || 
                nextLine.includes('E.V.') || 
                nextLine.includes('LTD') || 
                nextLine.includes('CO') || 
                /-\s*\d{5}/.test(nextLine) || 
                /^\d{10}$/.test(nextLine) || 
                nextLine === data.name || 
                nextLine === data.employmentType || 
                nextLine === data.contractType) {
                debug('Found end of project section', { stopLine: nextLine });
                break;
            }
            
            // Sor hozzáadása a projekthez
            debug('Adding line to project', { line: nextLine });
            projectLines.push(nextLine);
        }
        
        debug('Project lines', { lines: projectLines });
        data.projectName = projectLines.join(' ').replace(/\s+/g, ' ').trim();
        return true;
    }
    
    return false;
}

function processQRCode(line, data) {
    if (data.qrCodeId) return false;
    
    if (/^[A-Za-z0-9+/=]{20,}$/.test(line) || 
        /^[A-Za-z0-9-_]{20,}$/.test(line) || 
        /^[A-Za-z0-9]{20,}$/.test(line)) {
        data.qrCodeId = line;
        return true;
    }
    
    const noSpaces = line.replace(/\s+/g, '');
    if (noSpaces.length > 20 && /^[A-Za-z0-9+/=\-_]{20,}$/.test(noSpaces)) {
        data.qrCodeId = noSpaces;
        return true;
    }
}

// Űrlap adatok mentése és kártya generálása
app.post('/save-data', async (req, res) => {
    try {
        const formData = req.body || {};
        log('info', 'Generating business card');

        // Bemeneti mezők típus- és hosszellenőrzése (a túl nagy bemenet felesleges CPU/memória terhelés)
        const fieldLimits = {
            name: 200,
            identifier: 100,
            employmentType: 200,
            contractType: 200,
            companyName: 200,
            companyId: 100,
            projectName: 500,
            qrCodeId: 2000
        };

        for (const [key, maxLength] of Object.entries(fieldLimits)) {
            const value = formData[key];
            if (value !== undefined && value !== null && typeof value !== 'string') {
                log('warn', 'Business card generation failed - invalid field type', { field: key });
                return res.status(400).json({ error: `Invalid field: ${key}` });
            }
            if (typeof value === 'string' && value.length > maxLength) {
                log('warn', 'Business card generation failed - field too long', { field: key });
                return res.status(413).json({ error: `Field too long: ${key}` });
            }
            // Hiányzó mezők pótlása üres stringgel, hogy a canvas ne dobjon kivételt
            if (typeof value !== 'string') {
                formData[key] = '';
            }
        }

        // Kötelező mezők ellenőrzése
        if (!formData.qrCodeId) {
            log('warn', 'Business card generation failed - missing QR code');
            throw new Error('QR kód tartalom megadása kötelező');
        }
        
        // Canvas létrehozása a kártyához
        const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
        const ctx = canvas.getContext('2d');

        // Háttér beállítása
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        // Keret hozzáadása
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, CARD_WIDTH - 20, CARD_HEIGHT - 20);

        // Szöveg beállítások konfigurálása
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 42px Arial';
        ctx.textBaseline = 'top';

        // Szöveg terület szélességének számítása (szöveghez elérhető hely)
        const textAreaWidth = CARD_WIDTH - QR_SIZE - (MARGIN * 3);

        // Név rajzolása (nagyobb és félkövér)
        ctx.font = 'bold 38px Arial';
        ctx.fillText(formData.name, MARGIN, MARGIN);

        // Azonosító rajzolása
        ctx.font = '30px Arial';
        ctx.fillText(`Azonosító: ${formData.identifier}`, MARGIN, MARGIN + 55);

        // Foglalkoztatás és szerződés típus rajzolása
        ctx.font = '26px Arial';
        const employmentText = `${formData.employmentType} - ${formData.contractType}`;
        ctx.fillText(employmentText, MARGIN, MARGIN + 100);

        // Cég információk rajzolása
        const companyText = `${formData.companyName} (${formData.companyId})`;
        ctx.fillText(companyText, MARGIN, MARGIN + 145);

        // Projekt név rajzolása (tördeléssel és jobb térközökkel)
        ctx.font = '22px Arial';
        let y = MARGIN + 190;
        
        // Szövegtördelő függvény
        function wrapText(text, maxWidth) {
            const lines = [];
            let currentLine = '';
            
            text.split(' ').forEach(word => {
                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width > maxWidth && currentLine !== '') {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            });
            
            if (currentLine) {
                lines.push(currentLine);
            }
            
            return lines;
        }

        // Projekt név tördelése és rajzolása megfelelő térközökkel
        const lines = wrapText(formData.projectName, textAreaWidth);
        lines.forEach((line, index) => {
            ctx.fillText(line, MARGIN, y + (index * 30));
        });

        // QR kód generálása és rajzolása
        const qrCodeData = formData.qrCodeId;
        const qrCodeDataUrl = await QRCode.toDataURL(qrCodeData, {
            width: QR_SIZE,
            margin: 0,
            color: {
                dark: '#000000',
                light: '#ffffff'
            },
            errorCorrectionLevel: 'H'
        });

        // QR kód betöltése és rajzolása
        const qrImage = await loadImage(qrCodeDataUrl);
        // QR kód rajzolása függőlegesen középre és jobbra igazítva
        ctx.drawImage(qrImage, 
            CARD_WIDTH - QR_SIZE - MARGIN, 
            (CARD_HEIGHT - QR_SIZE) / 2, 
            QR_SIZE, 
            QR_SIZE);

        // Canvas konvertálása bufferré
        const buffer = canvas.toBuffer('image/png');

        // Kép optimalizálása sharp-pal
        const optimizedBuffer = await sharp(buffer)
            .png({ quality: 90 })
            .toBuffer();

        // Base64 konvertálás előnézethez
        const base64Image = `data:image/png;base64,${optimizedBuffer.toString('base64')}`;

        log('info', 'Business card generated successfully');
        res.json({ 
            success: true,
            cardImage: base64Image
        });
    } catch (error) {
        log('error', 'Business card generation failed', { error });
        res.status(500).json({ error: 'Failed to generate business card' });
    }
});

// Segédfüggvény kép betöltéséhez
async function loadImage(src) {
    const Image = require('canvas').Image;
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Multer / feltöltési hibák kezelése: JSON válasz, ne 500-as HTML hibaüzenet
app.use((err, req, res, next) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
        log('warn', 'Upload rejected - file too large');
        return res.status(413).json({ error: 'File too large (max 5MB)' });
    }
    if (err.message === 'Only PDF files are allowed') {
        log('warn', 'Upload rejected - not a PDF');
        return res.status(415).json({ error: 'Only PDF files are allowed' });
    }

    log('error', 'Unhandled request error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(port, '0.0.0.0', () => {
    log('info', `Server started on port ${port}`);
    console.log(`Server running at http://localhost:${port}`);
});

// Kezeletlen hibák naplózása: a folyamat ne álljon le némán
process.on('unhandledRejection', (reason) => {
    log('error', 'Unhandled promise rejection', { error: reason instanceof Error ? reason : new Error(String(reason)) });
});

process.on('uncaughtException', (error) => {
    log('error', 'Uncaught exception', { error });
});

// Tiszta leállás: konténer restart / watchtower frissítés ne szakítsa meg a futó kéréseket
function shutdown(signal) {
    log('info', `Received ${signal}, shutting down gracefully`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
