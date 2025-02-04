# QR Kód Webalkalmazás

PDF dokumentumokból QR kódokat és azonosító kártyákat generáló webalkalmazás.

## Funkciók

- PDF dokumentumok automatikus feldolgozása és adatkinyerése
- QR kód generálás és beolvasás
- Azonosító kártya generálás testreszabható elrendezéssel
- Magyar nevek és céges formátumok támogatása
- Reszponzív webes felület

## Előfeltételek

- Node.js 18 vagy újabb
- Docker (konténerizált telepítéshez)

## Fejlesztői Környezet

1. Függőségek telepítése:
   ```bash
   npm install
   ```

2. Fejlesztői szerver indítása:
   ```bash
   npm start
   ```

Az alkalmazás elérhető lesz a http://localhost:3000 címen.

## Docker Telepítés

1. Docker image építése:
   ```bash
   docker build -t qr-code-web .
   ```

2. Konténer futtatása:
   ```bash
   docker run -p 3000:3000 qr-code-web
   ```

Az alkalmazás elérhető lesz a http://localhost:3000 címen.

## Környezeti Változók

- `PORT`: Szerver port (alapértelmezett: 3000)
- `NODE_ENV`: Környezeti mód (development/production)

## Projekt Struktúra

```
.
├── public/             # Statikus fájlok
│   ├── index.html     # Fő QR kód generátor oldal
│   ├── uvegkapu.html  # Azonosító kártya generátor oldal
│   ├── styles.css     # Globális stílusok
│   └── scripts/       # Kliens oldali JavaScript
├── server.js          # Express szerver és API végpontok
├── package.json       # Projekt függőségek
├── Dockerfile         # Konténer konfiguráció
└── .dockerignore      # Docker build kizárások
```

## API Végpontok

- `POST /generate`: QR kód generálása szövegből
- `POST /process-pdf`: Adatok kinyerése PDF dokumentumból
- `POST /save-data`: Azonosító kártya generálása űrlap adatokból

## Docker Image Részletek

A Docker image többlépcsős build folyamattal készül:

1. Builder fázis:
   - Node.js Alpine alapkép használata
   - Függőségek telepítése
   - Forrásfájlok másolása

2. Produkciós fázis:
   - Minimális Alpine alapú kép
   - Csak produkciós függőségek
   - Non-root felhasználó
   - Méret és biztonság optimalizálás

## Biztonsági Funkciók

- Adatvédelem
  * PDF fájlok memóriában történő feldolgozása
  * Nincs fájl tárolás a lemezen
  * Nincs adatmegőrzés kérések között
  * Azonnali tisztítás feldolgozás után

- Konténer Biztonság
  * Non-root felhasználó
  * Minimális alapkép
  * Nincs adatmegőrzés
  * Csak memória műveletek

- Bemenet Validáció
  * Fájltípus ellenőrzés
  * Méretkorlátok (max 5MB)
  * Biztonságos PDF feldolgozás
  * Tartalom validáció

- Legjobb Gyakorlatok
  * HTTPS produkciós környezetben
  * Biztonságos fejlécek
  * Bemenet tisztítás
  * Hibakezelés

## Fejlesztői Mód

A fejlesztői módban részletes naplózás érhető el:

```bash
$env:NODE_ENV='development'; npm start
```

A naplófájlok a `logs` könyvtárban találhatók:
- `debug.log`: Részletes fejlesztői napló
- `app.log`: Produkciós napló (szenzitív adatok rejtve)

## Licenc

ISC
