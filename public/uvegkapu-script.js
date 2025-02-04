document.addEventListener('DOMContentLoaded', () => {
    const html5QrCode = new Html5Qrcode("qr-reader");
    let isScanning = false;

    // Elements
    const form = document.getElementById('data-form');
    const pdfUpload = document.getElementById('pdf-upload');
    const processPdfBtn = document.getElementById('process-pdf-btn');
    const qrImageUpload = document.getElementById('qr-image-upload');
    const startCameraBtn = document.getElementById('start-camera-btn');
    const qrPreview = document.getElementById('qr-preview');
    const pdfDropZone = document.querySelector('.pdf-drop-zone');
    const qrDropZone = document.querySelector('.qr-drop-zone');

    // Drag and drop handling
    function setupDragAndDrop(dropZone, fileInput, acceptedTypes, processFile) {
        const dropText = dropZone.querySelector('.drop-text');
        const selectedFile = dropZone.querySelector('.selected-file');

        function updateSelectedFile(file) {
            if (file) {
                selectedFile.textContent = `Kiválasztott fájl: ${file.name}`;
                selectedFile.classList.add('visible');
            } else {
                selectedFile.textContent = '';
                selectedFile.classList.remove('visible');
            }
        }

        // Add click handler to trigger file input
        dropText.addEventListener('click', () => {
            fileInput.click();
        });

        // Listen for file input changes
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (file) {
                updateSelectedFile(file);
            }
        });

        dropText.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropText.classList.add('drag-over');
        });

        dropText.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropText.classList.remove('drag-over');
        });

        dropText.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropText.classList.remove('drag-over');
            
            const file = e.dataTransfer.files[0];
            if (file && acceptedTypes.includes(file.type)) {
                updateSelectedFile(file);
                await processFile(file);
            } else {
                alert('Nem megfelelő fájltípus!');
            }
        });

        // Prevent drag events on the rest of the box
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    // Show/hide loading states
    function showProcessingStatus(type) {
        const container = type === 'pdf' ? pdfDropZone : qrDropZone;
        const status = container.querySelector('.processing-status');
        const button = container.querySelector('button');
        if (button) {
            button.disabled = true;
            const spinner = button.querySelector('.loading-spinner');
            if (spinner) spinner.style.display = 'inline-block';
        }
        if (status) status.style.display = 'flex';
    }

    function hideProcessingStatus(type) {
        const container = type === 'pdf' ? pdfDropZone : qrDropZone;
        const status = container.querySelector('.processing-status');
        const button = container.querySelector('button');
        if (button) {
            button.disabled = false;
            const spinner = button.querySelector('.loading-spinner');
            if (spinner) spinner.style.display = 'none';
        }
        if (status) status.style.display = 'none';
    }

    // Setup drag-n-drop for PDF
    setupDragAndDrop(
        pdfDropZone,
        pdfUpload,
        ['application/pdf'],
        async (file) => {
            showProcessingStatus('pdf');
            const formData = new FormData();
            formData.append('pdf', file);
            try {
                showProcessingStatus('pdf');
                const response = await fetch('/process-pdf', {
                    method: 'POST',
                    body: formData
                });
                if (!response.ok) throw new Error('PDF feldolgozási hiba');
            const data = await response.json();
            fillFormWithData(data);
            
            // Show success message with next steps
            const message = 'A PDF adatai sikeresen beolvasva!\n\n' +
                          'A biztonság érdekében az érzékeny adatok rejtve maradnak.\n\n' +
                          'Következő lépés: Olvassa be a QR kódot a dokumentumról\n' +
                          '- Használja a kamerát a "Kamera Használata" gombbal, vagy\n' +
                          '- Töltsön fel egy képet a QR kódról';
            alert(message);
            } catch (error) {
                console.error('Error:', error);
                alert('Hiba történt a PDF feldolgozása során. Kérjük, ellenőrizze a fájlt és próbálja újra.');
            } finally {
                hideProcessingStatus('pdf');
            }
        }
    );

    // Setup drag-n-drop for QR images
    setupDragAndDrop(
        qrDropZone,
        qrImageUpload,
        ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        async (file) => {
            showProcessingStatus('qr');
            try {
                const result = await html5QrCode.scanFile(file, true);
                handleQrCodeResult(result);
            } catch (error) {
                console.error('Error:', error);
                alert('Nem sikerült beolvasni a QR kódot a képről.');
            } finally {
                hideProcessingStatus('qr');
            }
        }
    );

    // PDF Processing
    processPdfBtn.addEventListener('click', async () => {
        const file = pdfUpload.files[0];
        if (!file) {
            alert('Kérjük, válasszon ki egy PDF fájlt!');
            return;
        }

        showProcessingStatus('pdf');
        const formData = new FormData();
        formData.append('pdf', file);

        try {
            const response = await fetch('/process-pdf', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('PDF feldolgozási hiba');
            }

            const data = await response.json();
            fillFormWithData(data);
        } catch (error) {
            console.error('Error:', error);
            alert('Hiba történt a PDF feldolgozása során.');
        } finally {
            hideProcessingStatus('pdf');
        }
    });

    // QR Code Image Processing
    qrImageUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const selectedFile = qrDropZone.querySelector('.selected-file');
        selectedFile.textContent = `Kiválasztott fájl: ${file.name}`;
        selectedFile.classList.add('visible');

        showProcessingStatus('qr');
        try {
            const result = await html5QrCode.scanFile(file, true);
            handleQrCodeResult(result);
        } catch (error) {
            console.error('Error:', error);
            alert('Nem sikerült beolvasni a QR kódot a képről.');
            selectedFile.textContent = '';
            selectedFile.classList.remove('visible');
        } finally {
            hideProcessingStatus('qr');
        }
    });

    // Camera Handling
    startCameraBtn.addEventListener('click', async () => {
        const qrReader = document.getElementById('qr-reader');
        if (isScanning) {
            await stopScanning();
            startCameraBtn.textContent = 'Kamera Használata';
            qrReader.classList.remove('active');
        } else {
            try {
                qrReader.classList.add('active');
                await startScanning();
                startCameraBtn.textContent = 'Kamera Leállítása';
            } catch (error) {
                console.error('Error:', error);
                alert('Nem sikerült elindítani a kamerát.');
                qrReader.classList.remove('active');
            }
        }
    });

    async function startScanning() {
        try {
            await html5QrCode.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                handleQrCodeResult,
                () => {}
            );
            isScanning = true;
        } catch (error) {
            console.error('Error starting camera:', error);
            throw error;
        }
    }

    async function stopScanning() {
        try {
            await html5QrCode.stop();
            isScanning = false;
            document.getElementById('qr-reader').classList.remove('active');
        } catch (error) {
            console.error('Error stopping camera:', error);
        }
    }

    function handleQrCodeResult(decodedText) {
        try {
            console.log('QR Code Content:', decodedText); // Debug log
            
            // Always store the raw QR code content
            const qrCodeField = document.getElementById('qr-code-id');
            qrCodeField.value = decodedText;
            
            // Get the current form data
            const currentData = {
                name: document.getElementById('name').value,
                identifier: document.getElementById('identifier').value,
                employmentType: document.getElementById('employment-type').value,
                contractType: document.getElementById('contract-type').value,
                projectName: document.getElementById('project-name').value,
                companyName: document.getElementById('company-name').value,
                companyId: document.getElementById('company-id').value,
                qrCodeId: decodedText
            };

            // Try to parse as JSON, but don't overwrite if parsing fails
            try {
                const jsonData = JSON.parse(decodedText);
                fillFormWithData(jsonData);
            } catch (jsonError) {
                // If not JSON, keep the current form data but update QR code ID
                fillFormWithData(currentData);
            }

            if (isScanning) {
                stopScanning();
                startCameraBtn.textContent = 'Kamera Használata';
            }
        } catch (error) {
            console.error('Error processing QR code:', error);
            alert('A QR kód nem tartalmaz érvényes adatokat.');
        }
    }

    function fillFormWithData(data) {
        // Fill form fields
        const fields = {
            'name': data.name,
            'identifier': data.identifier,
            'employment-type': data.employmentType,
            'contract-type': data.contractType,
            'project-name': data.projectName,
            'company-name': data.companyName,
            'company-id': data.companyId,
            'qr-code-id': data.qrCodeId
        };

        for (const [id, value] of Object.entries(fields)) {
            const element = document.getElementById(id);
            if (element && value) {
                element.value = value;
                // Make fields readonly except for QR code
                if (id !== 'qr-code-id') {
                    element.readOnly = true;
                    element.style.backgroundColor = '#f8f8f8';
                }
            }
        }

        // Update preview if available
        if (data.cardImage) {
            qrPreview.src = data.cardImage;
            qrPreview.style.display = 'block';
            qrPreview.style.maxWidth = '100%'; // Allow preview to be wider
            qrPreview.style.height = 'auto';
            qrPreview.style.marginTop = '2rem';
            qrPreview.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';
        }
    }

    // Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Check if QR code is present
        const qrCodeId = document.getElementById('qr-code-id').value;
        if (!qrCodeId) {
            alert('Kérjük, először olvassa be a QR kódot a dokumentumról!');
            return;
        }

        const formData = {
            name: document.getElementById('name').value,
            identifier: document.getElementById('identifier').value,
            employmentType: document.getElementById('employment-type').value,
            contractType: document.getElementById('contract-type').value,
            projectName: document.getElementById('project-name').value,
            companyName: document.getElementById('company-name').value,
            companyId: document.getElementById('company-id').value,
            qrCodeId: document.getElementById('qr-code-id').value
        };

        try {
            const response = await fetch('/save-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                throw new Error('Mentési hiba');
            }

            const result = await response.json();
            if (result.cardImage) {
                qrPreview.src = result.cardImage;
                qrPreview.style.display = 'block';
                qrPreview.style.maxWidth = '100%';
                qrPreview.style.height = 'auto';
                qrPreview.style.marginTop = '2rem';
                qrPreview.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';
                
                // Create download link
                const downloadLink = document.createElement('a');
                downloadLink.href = result.cardImage;
                downloadLink.download = 'uvegkapu-kartya.png';
                downloadLink.className = 'download-card-btn';
                downloadLink.textContent = 'Kártya Letöltése';
                downloadLink.style.display = 'block';
                downloadLink.style.marginTop = '1rem';
                downloadLink.style.textAlign = 'center';
                downloadLink.style.padding = '0.8rem';
                downloadLink.style.backgroundColor = '#4CAF50';
                downloadLink.style.color = 'white';
                downloadLink.style.textDecoration = 'none';
                downloadLink.style.borderRadius = '5px';
                downloadLink.style.cursor = 'pointer';
                
                // Replace old download button if exists
                const oldDownloadBtn = document.querySelector('.download-card-btn');
                if (oldDownloadBtn) {
                    oldDownloadBtn.remove();
                }
                qrPreview.parentNode.insertBefore(downloadLink, qrPreview.nextSibling);
            }

            alert('A kártya sikeresen elkészült! A letöltéshez kattintson a "Kártya Letöltése" gombra.');
        } catch (error) {
            console.error('Error:', error);
            if (error.message === 'QR kód tartalom megadása kötelező') {
                alert('Kérjük, először olvassa be a QR kódot a dokumentumról!');
            } else {
                alert('Hiba történt az adatok mentése során.');
            }
        }
    });
});
