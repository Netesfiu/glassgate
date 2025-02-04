const express = require('express');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { createCanvas, registerFont } = require('canvas');
const sharp = require('sharp');
const pdfParse = require('pdf-parse');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Development mode flag
const isDev = process.env.NODE_ENV !== 'production';

// Logger function
function log(type, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logData = {
        timestamp,
        type,
        message,
        ...data
    };

    // In dev mode, keep all data for debugging
    if (!isDev) {
        // Redact sensitive information in production
        if (logData.name) logData.name = 'REDACTED';
        if (logData.identifier) logData.identifier = 'REDACTED';
        if (logData.error?.stack) delete logData.error.stack;
    }

    // Format log entry
    const logEntry = JSON.stringify(logData) + '\n';
    fs.appendFileSync(path.join(logsDir, isDev ? 'debug.log' : 'app.log'), logEntry);

    // In dev mode, also log to console for debugging
    if (isDev) {
        console.log(`[${type.toUpperCase()}] ${message}`, data);
    }
}

// Debug logger - only logs in dev mode
function debug(message, data = {}) {
    if (isDev) {
        log('debug', message, data);
    }
}

// Standard credit card dimensions at 300 DPI
const CARD_WIDTH = 1050;  // 89mm at 300 DPI
const CARD_HEIGHT = 600;  // 51mm at 300 DPI
const QR_SIZE = 250;      // QR code size in pixels
const MARGIN = 50;        // Margin in pixels

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// API endpoint for QR code generation
app.post('/generate', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            log('warn', 'QR code generation failed - missing text');
            return res.status(400).json({ error: 'Text is required' });
        }

        const qrCode = await QRCode.toDataURL(text);
        log('info', 'QR code generated successfully');
        res.json({ qrCode });
    } catch (error) {
        log('error', 'QR code generation failed', { error });
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Process PDF and extract data
app.post('/process-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            log('warn', 'PDF processing failed - no file uploaded');
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const dataBuffer = req.file.buffer;
        const pdfData = await pdfParse(dataBuffer);
        
        // Get the text content
        const text = pdfData.text;
        debug('Raw PDF content', { text });
        log('info', 'PDF parsed successfully');

        // Initialize extracted data
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

        // Split text into lines and process each line
        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
        debug('Processed lines', { lineCount: lines.length, lines });
        
        for (const line of lines) {
            // Try to identify content based on patterns
            const cleanedLine = line.trim().replace(/\s+/g, ' ');
            debug('Processing line', { original: line, cleaned: cleanedLine });

            // Process each field
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

// Field processing functions
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
    
    // Skip if line is the identifier or name
    if (line === data.identifier || line === data.name) {
        return false;
    }
    
    // Must be after name and identifier, but not a contract type
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
    
    // Find the project line index
    const projectLineIndex = lines.findIndex(l => {
        const cleanedLine = l.trim().replace(/\s+/g, ' ');
        return /\d+\s*út\/vonalszám|\d+\s*[úu]t/.test(cleanedLine);
    });

    if (projectLineIndex >= 0) {
        debug('Found project line', { line: lines[projectLineIndex] });
        
        // Collect project lines
        const projectLines = [lines[projectLineIndex]];
        
        // Look ahead for additional location lines
        for (let i = projectLineIndex + 1; i < lines.length; i++) {
            const nextLine = lines[i].trim();
            debug('Checking next line', { nextLine });
            
            // Stop if we hit any of these markers
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
            
            // Add line to project
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

// Save form data and generate business card
app.post('/save-data', async (req, res) => {
    try {
        const formData = req.body;
        log('info', 'Generating business card');

        // Validate required fields
        if (!formData.qrCodeId) {
            log('warn', 'Business card generation failed - missing QR code');
            throw new Error('QR kód tartalom megadása kötelező');
        }
        
        // Create canvas for the business card
        const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
        const ctx = canvas.getContext('2d');

        // Set background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        // Add border
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, CARD_WIDTH - 20, CARD_HEIGHT - 20);

        // Configure text settings
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 42px Arial';
        ctx.textBaseline = 'top';

        // Calculate text area width (space available for text)
        const textAreaWidth = CARD_WIDTH - QR_SIZE - (MARGIN * 3);

        // Draw name (larger and bold)
        ctx.font = 'bold 38px Arial';
        ctx.fillText(formData.name, MARGIN, MARGIN);

        // Draw identifier
        ctx.font = '30px Arial';
        ctx.fillText(`Azonosító: ${formData.identifier}`, MARGIN, MARGIN + 55);

        // Draw employment and contract type
        ctx.font = '26px Arial';
        const employmentText = `${formData.employmentType} - ${formData.contractType}`;
        ctx.fillText(employmentText, MARGIN, MARGIN + 100);

        // Draw company info
        const companyText = `${formData.companyName} (${formData.companyId})`;
        ctx.fillText(companyText, MARGIN, MARGIN + 145);

        // Draw project name (wrapped with better spacing)
        ctx.font = '22px Arial';
        let y = MARGIN + 190;
        
        // Function to wrap text
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

        // Wrap and draw project name with proper spacing
        const lines = wrapText(formData.projectName, textAreaWidth);
        lines.forEach((line, index) => {
            ctx.fillText(line, MARGIN, y + (index * 30));
        });

        // Generate and draw QR code
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

        // Load and draw QR code
        const qrImage = await loadImage(qrCodeDataUrl);
        // Draw QR code centered vertically and aligned to the right
        ctx.drawImage(qrImage, 
            CARD_WIDTH - QR_SIZE - MARGIN, 
            (CARD_HEIGHT - QR_SIZE) / 2, 
            QR_SIZE, 
            QR_SIZE);

        // Convert canvas to buffer
        const buffer = canvas.toBuffer('image/png');

        // Optimize the image with sharp
        const optimizedBuffer = await sharp(buffer)
            .png({ quality: 90 })
            .toBuffer();

        // Convert to base64 for preview
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

// Helper function to load image
async function loadImage(src) {
    const Image = require('canvas').Image;
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

app.listen(port, () => {
    log('info', `Server started on port ${port}`);
    console.log(`Server running at http://localhost:${port}`);
});
