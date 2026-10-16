# Musik Arkasha — Website Musik Pribadi

Pemutar musik pribadi untuk Arkasha: cari lagu dari dua sumber online, putar
dalam satu antrean, dengan **visualisasi audio** di panggung utama.
Statis penuh (HTML/CSS/JS vanilla, tanpa build step), tanpa akun, tanpa
server data — favorit, playlist, dan riwayat tersimpan di `localStorage`
browser.

**Versi tayang: v1.2** (17 Okt 2026) — YouTube diputar sebagai **aliran
audio Piped** (bukan lagi embed sebagai jalur utama): bebas iklan, bisa
putar latar lewat Media Session, visualizer asli dari AnalyserNode.
Embed resmi YouTube kini hanya **fallback per trek** bila seluruh rantai
aliran Piped gagal, dan trek seperti itu ditandai label "embed".
(v1.1 = Media Session API; v1.0 = tayang perdana GitHub Pages, 17 Okt 2026.)

## Cara menjalankan

```bash
cd ~/workspace/musik-arkasha-web
python3 -m http.server 8766
# buka http://localhost:8766
```

Itu saja. (Server Python stdlib hanya menyajikan berkas.)

## Sumber musik

| Sumber | Cara kerja | Putar |
|---|---|---|
| **Internet Archive** | API resmi `advancedsearch` + `metadata` (tanpa kunci). Berkas dipilih dari metadata: mp3/ogg, bukan berkas `private` (yang dibatasi Archive → 401 untuk anonim) | **Streaming penuh** lewat elemen `<audio>` |
| **YouTube** | Pencarian + stream lewat API publik **Piped** (rantai rotasi 7 instance; yang terverifikasi dari VM Kav: `pipedapi.ducks.party`) | **Aliran audio**: dari `/streams/<videoId>` dipilih `audioStreams` terbaik (utamakan m4a/AAC, lalu Opus, bitrate tertinggi yang wajar ≤ ±256 kbps) dan diputar lewat elemen `<audio>` yang sama dengan trek Archive. Bila semua instance gagal untuk satu trek → **fallback embed resmi** YouTube IFrame API khusus trek itu, ditandai label "embed" |

Hasil kedua sumber digabung dalam satu daftar, tiap baris berlabel sumbernya
(`Archive · full` / `YouTube`), dengan filter chip Semua/Archive/YouTube.

## Fitur

- **Antrean gabungan** dua sumber; klik hasil = antrean dari daftar itu;
  tombol ＋ menambah satu lagu; hapus per item di tab Antrean.
- **Kontrol:** play/pause (juga spasi), next/prev (prev mengulang lagu bila
  sudah > 3 detik), seek, volume, shuffle, repeat mati/semua/satu —
  berlaku seragam untuk semua trek audio (Archive maupun YouTube);
  trek fallback embed memakai kontrol pemutar YouTube-nya.
- **Visualisasi** (Web Audio API `AnalyserNode` → canvas, 60fps):
  3 mode — **Batang** spektrum, **Gelombang**, **Radial**. Untuk trek
  YouTube aliran kini spektrumnya **asli** dari audio yang diputar.
  Aliran diuji CORS dulu (`crossOrigin="anonymous"` + probe): bila CORS
  menolak tap analyser, musik **tetap diputar** lewat elemen audio
  langsung tanpa tap, dan visual trek itu jatuh ke mode reaktif semu
  (ada catatan di UI).
- **Putar latar & kontrol sistem (Media Session API):** metadata trek
  (judul, penyanyi, sumber sebagai album, gambar sampul), handler
  play/pause/prev/next/seek yang terhubung ke kontrol pemutar yang sama,
  `playbackState`, dan `setPositionState` dilaporkan ke OS — berlaku
  untuk semua trek yang diputar lewat elemen `<audio>` (Archive +
  YouTube aliran), jadi putar berlanjut di latar dan bisa dikendalikan
  dari lock screen/notifikasi HP.
- **Favorit & Playlist** lokal (buat/hapus playlist, tambah lagu via modal),
  **Riwayat** 30 putaran terakhir.

## Batas jujur (penting)

1. **Visualisasi reaktif semu kini hanya untuk dua kasus:** (a) trek
   YouTube yang jatuh ke fallback embed (audio di dalam embed tidak bisa
   ditap, cross-origin), dan (b) aliran audio yang menolak tap analyser
   karena CORS — musiknya tetap diputar penuh, visualnya animasi denyut
   mengikuti status & waktu putar. Di luar dua kasus itu (Archive +
   YouTube aliran yang lolos CORS) spektrumnya **asli** dari audio.
   Kedua kasus ditampilkan sebagai catatan di UI saat trek diputar.
2. **Sebagian item Archive dibatasi** (berkas `private: 'true'` di metadata,
   mis. item podcast tertentu) → tidak bisa diputar anonim. Aplikasi
   melewati berkas seperti itu saat memilih, dan bila berkas gagal dimuat
   saat putar, antrean lanjut otomatis ke lagu berikutnya.
3. **Instance Piped bisa mati sewaktu-waktu** (layanan publik sukarela).
   Aplikasi merotasi 7 instance — untuk pencarian maupun pengambilan
   aliran — dan menampilkan instance yang aktif di footer. Bila semua
   instance gagal mengambil aliran untuk satu trek, trek itu saja yang
   jatuh ke embed resmi (label "embed"); antrean lain tidak ikut kena.
   Bila pencarian gagal total, Archive tetap jalan.
4. **Pemilik video dapat melarang embed** — itu hanya relevan untuk trek
   fallback embed: YouTube akan menolak memutar video seperti itu;
   aplikasi menampilkan pesan dan lagu lain bisa dipilih.
5. Kualitas/judul dari Archive mengikuti metadata komunitasnya (kadang
   item berisi banyak trek; yang dipilih adalah berkas audio terbaik
   menurut metadata — judul trek diambil dari metadata berkas bila ada).
6. **Putar latar & iklan:** trek yang diputar sebagai aliran audio
   (Archive + YouTube aliran) memakai jalur audio asli + Media Session
   (mekanisme standar putar latar web) dan **tanpa iklan dari embed**.
   Hanya trek fallback embed yang kembali ke perilaku YouTube: iklan
   dari YouTube dan latar ditentukan YouTube/OS. Perilaku akhir di HP
   (mis. hemat baterai agresif dari OS) tetap di tangan OS.
7. **Kondisi hulu Piped saat verifikasi v1.2 (17 Okt 2026, dicatat apa
   adanya):** extractor Piped sedang banyak ditolak YouTube
   ("sign in to confirm you're not a bot"), dan untuk video yang berhasil
   diekstrak kedua instance yang terjangkau (`pipedapi.ducks.party`,
   `api.piped.private.coffee`) mengembalikan `audioStreams` **kosong**
   (hanya stream video muxed). Artinya pada jendela itu trek YouTube
   nyata akan lebih sering jatuh ke fallback embed berlabel daripada
   biasanya — jalur kodenya sudah benar dan teruji (lihat Verifikasi),
   ketersediaan alirannya bergantung pada instance Piped pulih. Ini
   bukan sesuatu yang bisa diperbaiki dari kode situs.

## Verifikasi (17 Okt 2026, oleh Damar🦫)

### v1.2 — jalur aliran YouTube

Karena kondisi hulu Piped pada jendela verifikasi (lihat Batas jujur
butir 7) membuat aliran asli tidak bisa diputar ujung-ke-ujung dari VM,
jalur v1.2 dibuktikan dengan **harness uji lokal** (Chromium headless +
server Piped tiruan yang meniru kontrak API asli; harness tidak ikut
tayang):

- (a) Instance pertama mengembalikan `audioStreams` kosong → aplikasi
  **berpindah ke instance berikutnya** dan memutar dari sana.
- (b) Dari 3 kandidat (opus 64k, opus 512k, m4a 128k) yang dipilih =
  **m4a 128 kbps** — aturan m4a/AAC dulu, bitrate wajar.
- (c) Trek aliran tertap analyser: status `playing`, posisi maju,
  **freqAvg > 0** (spektrum dari audio asli, nada uji 440 Hz).
- (d) Aliran CORS-ditolak → mode `audio-direct`: **tetap playing**,
  tanpa tap, catatan CORS tampil di UI.
- (e) Semua instance gagal → mode `embed`: mount embed tampil, label
  now-playing "YouTube · embed", baris trek berlabel "embed".
- (f) Regresi Archive lewat jalur mulai-putar baru: `playing`, tertap,
  freqAvg > 0.
- (g) Bukti curl jaringan asli: pencarian Piped `pipedapi.ducks.party`
  sehat (hasil nyata); `/streams/` disampel di ±130 video pada instance
  yang terjangkau — hasilnya sesuai Batas jujur butir 7 (`audioStreams`
  kosong / extractor ditolak bot-wall YouTube pada jendela ini).

### v1.0/v1.1 — pembangunan + Media Session

Browser di VM Kav tidak punya egress internet langsung, jadi verifikasi
ujung-ke-ujung memakai **proksi dev lokal** (`tools/devproxy.py`) yang
meneruskan permintaan aplikasi ke archive.org/Piped lewat proxy egress
shell — data yang mengalir **asli**, yang berbeda hanya jalurnya. Tanpa
parameter `?proxy=` aplikasi memakai URL langsung (mode normal).

- (a) Cari `beethoven` → **24 hasil Archive** tampil berlabel `Archive · full`.
- (b) Cari `adele hello` → **20 hasil YouTube** (Piped `ducks.party`) +
  20 Archive, dalam satu daftar.
- (c) Putar trek Archive (Mozart — Piano Sonatas, Claudio Arrau) waktu riil
  via CDP (`tools/cdp-verify.mjs`): status `playing`, posisi maju
  (t ≈ 5 dtk saat sampel), **freqAvg analyser 13–19 (> 0 = spektrum dari
  audio asli)** — screenshot `04-sedang-diputar-desktop.png` menunjukkan
  batang spektrum tergambar.
- (d) Screenshot di `screenshot/`: beranda desktop/HP, hasil desktop,
  sedang-diputar desktop, radial HP.
- Putar di **HP beneran tidak bisa diverifikasi dari VM ini** (browser VM
  tidak menjangkau youtube.com; perilaku latar/lock-screen hanya terlihat
  di perangkat Arkasha) — yang terverifikasi di sini adalah jalur kode,
  pencarian, render hasil, dan putar audio lewat harness di atas.

Parameter uji (opsional): `?q=<kata>&autoplay=1&debug=1&mode=bars|wave|radial`
(`debug=1` menampilkan bilah statistik: sumber, mode putar, status tap
analyser, posisi, freqAvg, instance Piped aktif).

## Berkas

Repo tayang ini hanya berisi aplikasi:

- `index.html`, `style.css`, `app.js` — aplikasi.
- `README.md` — dokumen ini.

Alat uji (proksi dev, skrip CDP, harness Piped tiruan, screenshot bukti)
**tidak** ikut diterbitkan; mereka tinggal di folder pembangunan
`~/workspace/situs-musik/` dan `/tmp` mesin Kav.
