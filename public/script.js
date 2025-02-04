document.addEventListener('DOMContentLoaded', () => {
    const textInput = document.getElementById('text-input');
    const displayText = document.getElementById('display-text');
    const showText = document.getElementById('show-text');
    const generateBtn = document.getElementById('generate-btn');
    const qrCode = document.getElementById('qr-code');
    const downloadBtn = document.getElementById('download-btn');

    generateBtn.addEventListener('click', generateQRCode);
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            generateQRCode();
        }
    });
    downloadBtn.addEventListener('click', downloadQRCode);

    async function generateQRCode() {
        const text = textInput.value.trim();
        if (!text) {
            alert('Kérem, írjon be szöveget vagy URL-t');
            return;
        }

        try {
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generálás...';

            const requestData = {
                text,
                displayText: showText.checked ? displayText.value.trim() : null
            };

            const response = await fetch('/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
            });

            if (!response.ok) {
                throw new Error('Nem sikerült generálni a QR kódot');
            }

            const data = await response.json();
            qrCode.src = data.qrCode;
            qrCode.style.display = 'block';
            downloadBtn.style.display = 'block';
        } catch (error) {
            alert('Hiba történt a QR kód generálása során. Kérem, próbálja újra.');
            console.error('Error:', error);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'QR Kód Generálása';
        }
    }

    function downloadQRCode() {
        const link = document.createElement('a');
        link.download = 'qrcode.png';
        link.href = qrCode.src;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
});
