# Musik Arkasha — Website Musik Pribadi

Pemutar musik pribadi untuk Arkasha: cari lagu dari dua sumber online, putar
dalam satu antrean, dengan **visualisasi audio** di panggung utama.
Statis penuh (HTML/CSS/JS vanilla, tanpa build step), tanpa akun, tanpa
server data — favorit, playlist, dan riwayat tersimpan di `localStorage`
browser.

**Versi tayang: v1.1** (17 Okt 2026) — Media Session API: putar latar untuk
trek Archive + kontrol lock screen/notifikasi HP.
(v1.0 = tayang perdana GitHub Pages, 17 Okt 2026.)

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
| **YouTube** | Pencarian lewat API publik **Piped** (rantai fallback 7 instance; yang terverifikasi dari VM Kav: `pipedapi.ducks.party`) | **Hanya embed resmi** YouTube IFrame API — tidak ada unduhan/ekstraksi stream |

Hasil kedua sumber digabung dalam satu daftar, tiap baris berlabel sumbernya
(`Archive · full` / `YouTube`), dengan filter chip Semua/Archive/YouTube.

## Fitur

- **Antrean gabungan** dua sumber; klik hasil = antrean dari daftar itu;
  tombol ＋ menambah satu lagu; hapus per item di tab Antrean.
- **Kontrol:** play/pause (juga spasi), next/prev (prev mengulang lagu bila
  sudah > 3 detik), seek (Archive penuh; YouTube via `seekTo`), volume,
  shuffle, repeat mati/semua/satu.
- **Visualisasi** (Web Audio API `AnalyserNode` → canvas, 60fps):
  3 mode — **Batang** spektrum, **Gelombang**, **Radial**.
- **Putar latar & kontrol sistem (Media Session API):** metadata trek
  (judul, penyanyi, sumber sebagai album, gambar sampul), handler
  play/pause/prev/next/seek yang terhubung ke kontrol pemutar yang sama,
  `playbackState`, dan `setPositionState` dilaporkan ke OS — untuk trek
  Archive yang diputar lewat elemen `<audio>`, putar berlanjut di latar
  dan bisa dikendalikan dari lock screen/notifikasi HP.
- **Favorit & Playlist** lokal (buat/hapus playlist, tambah lagu via modal),
  **Riwayat** 30 putaran terakhir.

## Batas jujur (penting)

1. **Visualisasi YouTube bersifat reaktif semu.** Audio di dalam embed
   YouTube tidak bisa ditap (cross-origin), jadi untuk trek YouTube yang
   tampil adalah animasi denyut yang digerakkan status & waktu putar —
   bukan spektrum audio asli. Spektrum asli hanya untuk trek Archive.
   Perbedaan ini juga ditampilkan sebagai catatan di UI saat trek YouTube
   diputar.
2. **Sebagian item Archive dibatasi** (berkas `private: 'true'` di metadata,
   mis. item podcast tertentu) → tidak bisa diputar anonim. Aplikasi
   melewati berkas seperti itu saat memilih, dan bila berkas gagal dimuat
   saat putar, antrean lanjut otomatis ke lagu berikutnya.
3. **Instance Piped bisa mati sewaktu-waktu** (layanan publik sukarela).
   Aplikasi mencoba 7 instance bergiliran dan menampilkan instance yang
   aktif di footer. Bila semua mati, pencarian YouTube gagal tetapi Archive
   tetap jalan.
4. **Pemilik video dapat melarang embed** — YouTube akan menolak memutar
   video seperti itu; aplikasi menampilkan pesan dan lagu lain bisa dipilih.
5. Kualitas/judul dari Archive mengikuti metadata komunitasnya (kadang
   item berisi banyak trek; yang dipilih adalah berkas audio terbaik
   menurut metadata — judul trek diambil dari metadata berkas bila ada).
6. **Putar latar & iklan YouTube bukan ranah situs ini.** Trek YouTube
   diputar lewat embed resmi di dalam iframe YouTube: iklan berasal dari
   YouTube, dan perilaku latarnya ditentukan YouTube/OS — tidak bisa
   diubah dari kode situs tanpa meninggalkan cara embed resmi. Yang
   dijamin situs: trek **Archive** memakai jalur audio asli + Media
   Session (mekanisme standar putar latar web); perilaku akhir
   (mis. hemat baterai agresif dari OS HP) tetap di tangan OS.

## Verifikasi (17 Okt 2026, oleh Damar🦫)

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
- Putar **embed YouTube tidak bisa diverifikasi dari VM ini** (youtube.com
  tidak terjangkau dari browser VM sama sekali) — kodenya memakai IFrame API
  resmi dan akan jalan di jaringan normal; yang terverifikasi di sini adalah
  pencarian + render hasilnya.

Parameter uji (opsional): `?q=<kata>&autoplay=1&debug=1&mode=bars|wave|radial&proxy=<url proksi dev>`.

## Berkas

- `index.html`, `style.css`, `app.js` — aplikasi.
- `tools/devproxy.py` — proksi dev untuk verifikasi (bukan untuk pemakaian normal).
- `tools/cdp-verify.mjs` — skrip verifikasi CDP + screenshot.
- `screenshot/` — bukti visual hasil verifikasi.
