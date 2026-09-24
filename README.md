# QR Kód Webalkalmazás

PDF dokumentumokból QR kódokat és azonosító kártyákat generáló webalkalmazás.

## Funkciók

- PDF dokumentumok automatikus feldolgozása és adatkinyerése
- QR kód generálás és beolvasás
- Azonosító kártya generálás testreszabható elrendezéssel
- Magyar nevek és céges formátumok támogatása
- Reszponzív webes felület
- Drag-and-drop fájl feltöltés
- Kamera használat QR kód beolvasáshoz

## Előfeltételek

- Node.js 22 vagy újabb (LTS)
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

1. Image építése (produkciós Dockerfile):
   ```bash
   docker build -f Dockerfile.prod -t glassgate .
   ```

2. Konténer futtatása (erőforrás- és biztonsági korlátokkal):
   ```bash
   docker run -d --name glassgate \
     --restart unless-stopped \
     --user 10001:10001 \
     --read-only --tmpfs /tmp:size=64m \
     --security-opt no-new-privileges:true --cap-drop ALL \
     -e NODE_ENV=production -e PORT=3000 -e LOG_DIR=/tmp/logs \
     -p 3000:3000 glassgate
   ```

3. Docker Compose + Traefik (ajánlott): lásd a `docker-compose.yml` fájlt.

Az alkalmazás elérhető lesz a http://localhost:3000 címen.

## Előre épített image-ek

A GitHub Actions (`.github/workflows/docker-build.yml`) minden `main` ágra történő push esetén
lefuttat egy füsttesztet (healthcheck, QR generálás, nem-PDF elutasítás), majd publikálja az image-eket:

- `ghcr.io/netesfiu/glassgate:latest` – produkciós image (elsődleges)
- `ghcr.io/netesfiu/glassgate:<commit-sha>` – visszagörgethető verzió
- `ghcr.io/netesfiu/glassgate:dev` – fejlesztői image
- `netesfiu/glassgate:latest` – Docker Hub (ha a secret-ek érvényesek)

Frissítés (pl. Watchtower által vagy kézzel):

```bash
docker pull ghcr.io/netesfiu/glassgate:latest
docker compose up -d --force-recreate glassgate
```

## Környezeti Változók

- `PORT`: Szerver port (alapértelmezett: 3000)
- `NODE_ENV`: Környezeti mód (development/production)
- `LOG_DIR`: Naplókönyvtár (alapértelmezett: `<app>/logs`; read-only rootfs esetén pl. `/tmp/logs`)

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
├── LICENSE           # MIT licenc
├── Dockerfile.prod    # Produkciós image
├── Dockerfile.dev     # Fejlesztői image
├── docker-compose.yml # Példa deployment (Traefik + hardening)
├── .github/workflows/ # CI: build, füstteszt, GHCR/Docker Hub push
└── .dockerignore      # Docker build kizárások
```

## API Végpontok

- `GET /healthz`: Egészségügyi végpont (healthcheck / monitorozás) – `{"status":"ok"}`
- `POST /generate`: QR kód generálása szövegből
- `POST /process-pdf`: Adatok kinyerése PDF dokumentumból (csak PDF, max 5MB, max 50 oldal)
- `POST /save-data`: Azonosító kártya generálása űrlap adatokból

## Docker Image Részletek

A Docker image többlépcsős build folyamattal készül (`Dockerfile.prod`):

1. Builder fázis:
   - `node:22-bookworm-slim` alapkép (LTS)
   - Build függőségek a natív modulokhoz (canvas, sharp)
   - `npm ci --omit=dev` a lockfile szerinti, reprodukálható telepítéshez

2. Produkciós fázis:
   - `node:22-bookworm-slim` alapkép, csak a szükséges futásidejű csomagokkal
   - Nem root felhasználó **determinisztikus, numerikus UID/GID-del** (`USER 10001:10001`) –
     numerikus UID esetén a Docker nem végez passwd-feloldást, ezért egy sérült overlay
     állapot nem tudja „unhealthy"-vé tenni a konténert, és nem tünteti el a Traefik route-ot
   - `HEALTHCHECK` node-alapú HTTP próbával a `/healthz` végponton (a `curl` nincs a képen)
   - `STOPSIGNAL SIGTERM` + graceful leállás a zökkenőmentes újraindításhoz (Watchtower)

## Biztonsági Funkciók

- Adatvédelem
  * PDF fájlok memóriában történő feldolgozása
  * Nincs fájl tárolás a lemezen
  * Nincs adatmegőrzés kérések között
  * Azonnali tisztítás feldolgozás után

- Konténer Biztonság
  * Non-root felhasználó (numerikus UID/GID)
  * Minimális alapkép, `--cap-drop ALL`, `no-new-privileges`
  * Read-only rootfs + tmpfs a futásidejű írásokhoz
  * Memória-/CPU-korlátok a compose fájlban
  * Nincs adatmegőrzés, csak memória műveletek

- Bemenet Validáció
  * Fájltípus ellenőrzés (csak PDF, MIME + kiterjesztés alapján)
  * Méretkorlátok (max 5MB), fájlszám- és mezőkorlátok
  * JSON body méretkorlát (256 kB) és mezőhossz-korlátok
  * PDF oldalkorlát (max 50 oldal)
  * Tartalom validáció, JSON hibaválaszok (400/413/415)

- PDF feldolgozás
  * Karbantartott pdf.js (`pdfjs-dist`) az elavult `pdf-parse` helyett
  * `isEvalSupported: false` – a PDF-be ágyazott tartalom nem tud kódot generáltatni
    (CVE-2024-4367 osztály kizárva)

- Legjobb Gyakorlatok
  * HTTPS produkciós környezetben
  * Biztonsági HTTP fejlécek (X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
    HSTS, Cross-Origin-Resource-Policy, Permissions-Policy – a kamera a QR-beolvasóhoz engedélyezett)
  * `X-Powered-By` fejléc elrejtése
  * Karbantartott függőségek, `npm audit` alapján 0 ismert sebezhetőség
  * Hibakezelés: kezeletlen hibák naplózása, a folyamat nem áll le némán

## Fejlesztői Mód

A fejlesztői módban részletes naplózás érhető el:

```bash
$env:NODE_ENV='development'; npm start
```

A naplófájlok a `LOG_DIR` könyvtárban találhatók (alapértelmezés: `logs`):
- `debug.log`: Részletes fejlesztői napló
- `app.log`: Produkciós napló (szenzitív adatok rejtve)

## Üzemeltetés

- **Egészségügyi végpont:** `GET /healthz` (a Docker healthcheck is ezt hívja 30 másodpercenként).
  A Traefik kizárólag `healthy` állapotú konténerekhez publikál route-ot, ezért a healthcheck
  hibája egyben a domain elérhetetlenségét is jelenti – a healthcheck ezért nem függ a `curl`
  meglététől és nem igényel passwd-feloldást.
- **Frissítés:** Watchtower (névalapú lista) vagy kézi `docker compose up -d --force-recreate`.
  A `/healthz` és a graceful leállás miatt az újraindítás nem szakít meg kéréseket.
- **Visszagörgetés:** a `:<commit-sha>` taggel jelölt image-ekkel.

## Közreműködés

A projekt nyílt forráskódú, minden közreműködést szívesen fogadunk! A forráskód elérhető a [GitHub](https://github.com/Netesfiu/glassgate) oldalon.

1. Fork-old a projektet
2. Hozz létre egy új branch-et a fejlesztéshez
3. Commit-old a változtatásokat
4. Push-old a branch-et
5. Nyiss egy Pull Request-et

## Licenc

Ez a projekt az [MIT licenc](LICENSE) alatt áll. További információért lásd a LICENSE fájlt.
