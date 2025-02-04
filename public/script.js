document.addEventListener('DOMContentLoaded', () => {
    const textInput = document.getElementById('text-input');
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
            alert('Please enter some text or URL');
            return;
        }

        try {
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';

            const response = await fetch('/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                throw new Error('Failed to generate QR code');
            }

            const data = await response.json();
            qrCode.src = data.qrCode;
            qrCode.style.display = 'block';
            downloadBtn.style.display = 'block';
        } catch (error) {
            alert('Error generating QR code. Please try again.');
            console.error('Error:', error);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate QR Code';
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
