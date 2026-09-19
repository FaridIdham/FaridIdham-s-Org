import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

dotenv.config();

const PORT = 3000;
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Lazy initialize Gemini AI client with required User-Agent
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in the environment.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

// Resilient JSON parser that handles code blocks or whitespace
function parseGeminiJson(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

function extractRawStringsFromPdf(buffer: Buffer): string {
  try {
    const raw = buffer.toString('latin1');
    const matches = raw.match(/\(([^()]{2,})\)/g);
    if (matches && matches.length > 5) {
      return matches.map(m => m.slice(1, -1)).join(' ');
    }
  } catch (e) {
    // ignore
  }
  return '';
}

// Local intelligent regex parser as an instant zero-downtime fallback
function parseQuestionsLocally(rawText: string, defaultPoints: number = 10): any[] {
  const lines = rawText.split(/\r?\n/);
  const questions: any[] = [];
  let currentQ: any = null;

  // Global key map: questionNumber -> answer letter (e.g. KUNCI JAWABAN: 1. A, 2. B, 3. C)
  const globalKeyMap = new Map<number, string>();
  const globalKeyRegex = /(?:^|\s)(?:no\.?\s*)?(\d+)[\.\:\-\)]\s*([A-Ea-e])\b/g;
  let inKeySection = false;

  for (const line of lines) {
    if (/kunci\s*(?:jawaban)?|answer\s*key/i.test(line)) {
      inKeySection = true;
    }
    if (inKeySection) {
      let m: RegExpExecArray | null;
      while ((m = globalKeyRegex.exec(line)) !== null) {
        globalKeyMap.set(parseInt(m[1], 10), m[2].toUpperCase());
      }
    }
  }

  // Regex patterns supporting various numbering formats
  const qRegex = /^(?:(?:soal|no\.?|nomor|pertanyaan|q)\s*)?(?:(\d+)[\.\:\)]|\((\d+)\)|\[(\d+)\])\s*(.*)/i;
  const inlineOptRegex = /(?:^|\s+)([A-Ea-e])[\.\)]\s+([^\n\r]+?)(?=(?:\s+[A-Ea-e][\.\)]\s+)|$)/g;
  const singleOptRegex = /^\s*(?:\(([A-Ea-e])\)|\[([A-Ea-e])\]|([A-Ea-e])[\.\)\:\-])\s*(.*)/;
  const localKeyRegex = /(?:kunci\s*(?:jawaban)?|jawaban\s*(?:benar)?|ans(?:wer)?)\s*[:=\-]?\s*([A-Ea-e])/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if we hit global answer key section
    if (/kunci\s*(?:jawaban)?\s*(?:ujian|soal)?\s*[:=]?/i.test(line) && !singleOptRegex.test(line)) {
      if (globalKeyMap.size > 0 || /kunci\s*jawaban/i.test(line)) {
        break; // Stop parsing question bodies, answer keys are handled
      }
    }

    const qMatch = line.match(qRegex);
    const isOptionLine = singleOptRegex.test(line);

    // If it's a question number header
    if (qMatch && !isOptionLine && !/kunci\s*(?:jawaban)?/i.test(line)) {
      const qNum = parseInt(qMatch[1] || qMatch[2] || qMatch[3], 10);
      if (currentQ && currentQ.text) {
        questions.push(currentQ);
      }
      currentQ = {
        number: qNum || (questions.length + 1),
        text: (qMatch[4] || '').trim(),
        type: 'MULTIPLE_CHOICE',
        options: [] as string[],
        correctAnswer: '',
        correctOptionIndices: [0],
        points: defaultPoints,
        explanation: 'Diekstrak menggunakan parser lokal cerdas.'
      };
      continue;
    }

    if (currentQ) {
      // Check for horizontal inline options like: A. Apel  B. Mangga  C. Jeruk  D. Pisang
      const inlineMatches: { letter: string; text: string }[] = [];
      let im: RegExpExecArray | null;
      inlineOptRegex.lastIndex = 0;
      while ((im = inlineOptRegex.exec(line)) !== null) {
        inlineMatches.push({ letter: im[1].toUpperCase(), text: im[2].trim() });
      }

      if (inlineMatches.length >= 2) {
        for (const opt of inlineMatches) {
          const isCorrect = opt.text.includes('*') || /[\(]\s*kunci\s*[\)]/i.test(opt.text);
          const cleanOptText = opt.text.replace(/\*+/g, '').replace(/[\(]\s*kunci\s*[\)]/i, '').trim();
          currentQ.options.push(cleanOptText);
          if (isCorrect) {
            currentQ.correctAnswer = cleanOptText;
            currentQ.correctOptionIndices = [currentQ.options.length - 1];
          }
        }
        continue;
      }

      // Check for standard single option line: A. Opsi
      const optMatch = line.match(singleOptRegex);
      if (optMatch) {
        let optText = (optMatch[4] || '').trim();
        const isCorrect = optText.includes('*') || /[\(]\s*kunci\s*[\)]/i.test(optText);
        optText = optText.replace(/\*+/g, '').replace(/[\(]\s*kunci\s*[\)]/i, '').trim();
        currentQ.options.push(optText);
        if (isCorrect) {
          currentQ.correctAnswer = optText;
          currentQ.correctOptionIndices = [currentQ.options.length - 1];
        }
        continue;
      }

      // Check for inline answer key: Kunci: A
      const keyMatch = line.match(localKeyRegex);
      if (keyMatch) {
        const letter = keyMatch[1].toUpperCase();
        const idx = letter.charCodeAt(0) - 65;
        if (idx >= 0 && idx < currentQ.options.length) {
          currentQ.correctAnswer = currentQ.options[idx];
          currentQ.correctOptionIndices = [idx];
        }
        continue;
      }

      // Question body text continuation
      if (currentQ.options.length === 0) {
        currentQ.text += (currentQ.text ? ' ' : '') + line;
      }
    }
  }

  if (currentQ && currentQ.text) {
    questions.push(currentQ);
  }

  // If standard numbering failed, fallback to paragraph-based parsing
  if (questions.length === 0) {
    const blocks = rawText.split(/\n\s*\n+/);
    for (const block of blocks) {
      const bLines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (bLines.length === 0) continue;

      let qText = '';
      const options: string[] = [];
      let correctAnswer = '';
      let correctOptionIndices = [0];

      for (const bLine of bLines) {
        const optMatch = bLine.match(singleOptRegex);
        if (optMatch) {
          let optText = (optMatch[4] || '').trim();
          const isCorrect = optText.includes('*');
          optText = optText.replace(/\*+/g, '').trim();
          options.push(optText);
          if (isCorrect) {
            correctAnswer = optText;
            correctOptionIndices = [options.length - 1];
          }
        } else if (options.length === 0) {
          qText += (qText ? ' ' : '') + bLine;
        }
      }

      if (qText) {
        questions.push({
          number: questions.length + 1,
          text: qText,
          type: options.length > 0 ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
          options,
          correctAnswer: correctAnswer || (options[0] || ''),
          correctOptionIndices: options.length > 0 ? correctOptionIndices : [],
          points: defaultPoints,
          explanation: 'Diekstrak menggunakan parser lokal cerdas.'
        });
      }
    }
  }

  // Apply global key map & ensure valid fallbacks
  for (const q of questions) {
    if (globalKeyMap.has(q.number)) {
      const letter = globalKeyMap.get(q.number)!;
      const idx = letter.charCodeAt(0) - 65;
      if (idx >= 0 && idx < q.options.length) {
        q.correctAnswer = q.options[idx];
        q.correctOptionIndices = [idx];
      }
    }
    if (q.options.length === 0) {
      q.type = 'SHORT_ANSWER';
      q.correctOptionIndices = [];
    } else if (!q.correctAnswer && q.options.length > 0) {
      q.correctAnswer = q.options[0];
      q.correctOptionIndices = [0];
    }
  }

  return questions;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint to record cheating violation and generate official WhatsApp & Email dispatch data
app.post('/api/notify-cheating', (req, res) => {
  const {
    studentName,
    studentEmail,
    studentWhatsApp,
    quizTitle,
    violationReason,
    questionNumber,
    timestamp
  } = req.body;

  const eventTime = timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  // Format the official Indonesian WhatsApp alert
  const whatsappMessage =
    `⚠️ *PERINGATAN RESMI: ANDA TELAH MELAKUKAN KECURANGAN DALAM HAL MENJAWAB SOAL*\n\n` +
    `👤 *Nama Peserta:* ${studentName || 'Peserta Ujian'}\n` +
    `📝 *Ujian:* ${quizTitle || 'Ujian Online'}\n` +
    `🔢 *Sedang Menjawab Soal:* #${questionNumber || 1}\n` +
    `⏰ *Waktu Terdeteksi:* ${eventTime}\n\n` +
    `⛔ *Pelanggaran:* ${violationReason || 'Membuka tab baru / mengakses browser atau aplikasi lain'}\n\n` +
    `🚨 *TINDAKAN DISIPLIN:* Sesuai instruksi ujian, formulir ujian telah *OTOMATIS DITUTUP SENDIRI* dan pengerjaan Anda dibatalkan.\n\n` +
    `_Pemberitahuan otomatis Sistem Pengawas FormQuiz AI_`;

  let cleanPhone = (studentWhatsApp || '').replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('08')) {
    cleanPhone = '62' + cleanPhone.slice(1);
  } else if (cleanPhone.startsWith('8')) {
    cleanPhone = '62' + cleanPhone;
  }

  const whatsappUrl = cleanPhone
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(whatsappMessage)}`
    : null;

  console.warn(`[ANTI-CHEAT ALERT] Cheating detected for ${studentName} on Quiz "${quizTitle}" Q#${questionNumber}: ${violationReason}`);

  res.json({
    success: true,
    whatsappUrl,
    whatsappMessage,
    loggedAt: new Date().toISOString(),
    message: 'Pelanggaran kecurangan berhasil dicatat dan notifikasi siap dikirimkan.'
  });
});

// Provide realistic Indonesian sample quizzes for instant testing
app.get('/api/sample-quizzes', (req, res) => {
  res.json([
    {
      id: 'sample-biologi',
      title: 'Ujian Akhir Semester - Biologi SMA (Sistem Ekskresi & Metabolisme)',
      description: 'Latihan soal persiapan Ujian Akhir Semester Biologi SMA Kelas XI. Terdiri dari soal pilihan ganda dan esai.',
      defaultPointsPerQuestion: 10,
      securitySettings: {
        timePerQuestionMinutes: 1,
        enableAntiCheat: true,
        blockTabSwitch: true,
        blockBrowserSwitch: true,
        blockNewTabKeys: true,
        fullScreenEnforced: true,
        autoCloseOnViolation: true,
        sendEmailNotification: true,
        sendWhatsAppNotification: true
      },
      questions: [
        {
          id: 'q1',
          number: 1,
          text: 'Organ tubuh manusia yang berfungsi utama menyaring darah dan menghasilkan urine adalah...',
          type: 'MULTIPLE_CHOICE',
          options: ['Ginjal', 'Hati', 'Paru-paru', 'Kulit', 'Pankreas'],
          correctAnswer: 'Ginjal',
          correctOptionIndices: [0],
          points: 10,
          timeLimitMinutes: 1,
          explanation: 'Ginjal adalah organ ekskresi utama yang memfiltrasi darah di nefron untuk membentuk urine primer dan sekunder.'
        },
        {
          id: 'q2',
          number: 2,
          text: 'Bagian dari nefron ginjal tempat terjadinya proses filtrasi darah membentuk urine primer adalah...',
          type: 'MULTIPLE_CHOICE',
          options: ['Tubulus Kontortus Proksimal', 'Glomerulus dan Kapsula Bowman', 'Tubulus Kolektivus', 'Lengkung Henle', 'Ureter'],
          correctAnswer: 'Glomerulus dan Kapsula Bowman',
          correctOptionIndices: [1],
          points: 10,
          timeLimitMinutes: 1,
          explanation: 'Filtrasi berlangsung di glomerulus yang dikelilingi oleh kapsula Bowman.'
        },
        {
          id: 'q3',
          number: 3,
          text: 'Pilihlah zat-zat sisa metabolisme yang diekskresikan oleh organ paru-paru dan kulit! (Pilih opsi yang benar)',
          type: 'CHECKBOX',
          options: ['Karbon dioksida (CO2)', 'Uap air (H2O)', 'Keringat (Garam mineral & Urea)', 'Asam urat pekat'],
          correctAnswer: 'Karbon dioksida (CO2)',
          correctOptionIndices: [0, 1, 2],
          points: 15,
          timeLimitMinutes: 1,
          explanation: 'Paru-paru mengekskresikan CO2 dan H2O, sedangkan kulit mengekskresikan keringat yang mengandung air, garam mineral, dan sedikit urea.'
        },
        {
          id: 'q4',
          number: 4,
          text: 'Jelaskan secara ringkas 3 tahapan utama pembentukan urine pada ginjal manusia!',
          type: 'PARAGRAPH',
          options: [],
          correctAnswer: 'Filtrasi (di glomerulus), Reabsorpsi (di tubulus proksimal), dan Augmentasi (di tubulus distal).',
          correctOptionIndices: [],
          points: 20,
          timeLimitMinutes: 1,
          explanation: 'Tahapan pembentukan urine meliputi penyaringan darah (filtrasi), penyerapan kembali zat berguna (reabsorpsi), dan pengeluaran sisa racun (augmentasi).'
        }
      ]
    },
    {
      id: 'sample-tik',
      title: 'Kuis Informatika & Literasi Digital - Menengah',
      description: 'Ujian pemahaman konsep dasar komputasi awan, keamanan sandi, dan jaringan internet.',
      defaultPointsPerQuestion: 10,
      securitySettings: {
        timePerQuestionMinutes: 1,
        enableAntiCheat: true,
        blockTabSwitch: true,
        blockBrowserSwitch: true,
        blockNewTabKeys: true,
        fullScreenEnforced: true,
        autoCloseOnViolation: true,
        sendEmailNotification: true,
        sendWhatsAppNotification: true
      },
      questions: [
        {
          id: 't1',
          number: 1,
          text: 'Protokol internet yang mengenkripsi pertukaran data antara browser dan server web secara aman adalah...',
          type: 'MULTIPLE_CHOICE',
          options: ['HTTP', 'HTTPS', 'FTP', 'SMTP', 'Telnet'],
          correctAnswer: 'HTTPS',
          correctOptionIndices: [1],
          points: 10,
          timeLimitMinutes: 1,
          explanation: 'HTTPS (Hypertext Transfer Protocol Secure) menggunakan enkripsi SSL/TLS untuk keamanan transmisi.'
        },
        {
          id: 't2',
          number: 2,
          text: 'Manakah dari berikut ini yang merupakan contoh layanan Google Workspace berbasis awan (Cloud)?',
          type: 'MULTIPLE_CHOICE',
          options: ['Google Forms, Docs, dan Drive', 'Notepad bawaan Windows', 'Adobe Photoshop CS6 portable', 'Command Prompt CMD'],
          correctAnswer: 'Google Forms, Docs, dan Drive',
          correctOptionIndices: [0],
          points: 10,
          timeLimitMinutes: 1,
          explanation: 'Google Forms, Docs, dan Drive adalah bagian dari ekosistem Google Workspace yang tersinkronisasi online.'
        },
        {
          id: 't3',
          number: 3,
          text: 'Tuliskan kepanjangan dari singkatan "API" dalam bidang pemrograman perangkat lunak!',
          type: 'SHORT_ANSWER',
          options: [],
          correctAnswer: 'Application Programming Interface',
          correctOptionIndices: [],
          points: 10,
          timeLimitMinutes: 1,
          explanation: 'API singkatan dari Application Programming Interface.'
        }
      ]
    }
  ]);
});

// Extract questions endpoint
app.post('/api/extract-questions', async (req, res) => {
  try {
    const { fileBase64, mimeType, fileName, userPrompt } = req.body;
    const rawText = req.body.rawText || req.body.text || '';

    let extractedText = '';
    let isPdf = false;
    let cleanBase64 = '';
    const defaultPoints = 10;

    if (fileBase64) {
      // Remove data URL prefix if present
      cleanBase64 = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
    }

    if (mimeType === 'application/pdf' || (fileName && fileName.toLowerCase().endsWith('.pdf'))) {
      isPdf = true;
      if (cleanBase64) {
        try {
          const buffer = Buffer.from(cleanBase64, 'base64');
          const parser: any = new PDFParse({ data: buffer });
          const parsedResult: any = await parser.getText();
          const textValue = typeof parsedResult === 'string' ? parsedResult : (parsedResult?.text || '');
          if (typeof textValue === 'string' && textValue.trim().length > 0) {
            extractedText = textValue.trim();
          }
        } catch (pdfErr) {
          console.warn('PDF text extraction notice:', pdfErr);
        }

        // If parser yielded empty text, try raw string extraction from PDF buffer
        if (!extractedText || extractedText.trim().length === 0) {
          try {
            const buffer = Buffer.from(cleanBase64, 'base64');
            const fallbackText = extractRawStringsFromPdf(buffer);
            if (fallbackText && fallbackText.trim().length > 0) {
              extractedText = fallbackText.trim();
            }
          } catch (e) {
            // ignore
          }
        }
      }
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword' ||
      (fileName && (fileName.toLowerCase().endsWith('.docx') || fileName.toLowerCase().endsWith('.doc')))
    ) {
      // Process Word document via mammoth
      try {
        const buffer = Buffer.from(cleanBase64, 'base64');
        const mammothResult = await mammoth.extractRawText({ buffer });
        extractedText = mammothResult.value;
      } catch (err: any) {
        console.error('Mammoth extraction failed:', err);
        return res.status(400).json({
          error: 'Gagal mengekstrak teks dari file Word. Pastikan format file .docx tidak rusak atau coba salin teks langsung ke tab input teks.',
          details: err.message
        });
      }
    } else if (rawText && typeof rawText === 'string') {
      extractedText = rawText;
    } else if (cleanBase64) {
      // Treat as plain text decoded
      try {
        extractedText = Buffer.from(cleanBase64, 'base64').toString('utf-8');
      } catch (e) {
        extractedText = '';
      }
    }

    let ai: GoogleGenAI | null = null;
    try {
      ai = getGeminiClient();
    } catch (keyErr: any) {
      console.warn('Gemini client initialization notice:', keyErr?.message || keyErr);
    }

    const systemPrompt = `Anda adalah asisten AI spesialis ekstraksi soal ujian dan kuis untuk guru dan tenaga pengajar Indonesia.
Tugas Anda adalah membaca materi dokumen soal ujian (bisa berupa teks atau PDF) dan menguraikannya menjadi kumpulan soal terstruktur dengan format JSON yang sangat akurat.

Aturan Penting:
1. Identifikasi judul kuis/ujian dari dokumen jika ada (contoh: "Penilaian Harian Matematika", "Ujian Akhir Semester Biologi"), atau buat judul yang relevan berdasarkan konteks isi.
2. Ekstrak deskripsi instruksi ujian (contoh: "Pilihlah salah satu jawaban yang paling tepat!").
3. Deteksi tipe setiap soal:
   - "MULTIPLE_CHOICE" jika soal pilihan ganda (biasanya opsi A, B, C, D, E).
   - "CHECKBOX" jika soal memilih lebih dari satu jawaban benar.
   - "SHORT_ANSWER" jika soal isian singkat (1-2 kata).
   - "PARAGRAPH" jika soal esai/uraian panjang.
4. Opsi jawaban (options):
   - Bersihkan prefix huruf seperti "A. ", "B. ", "a) ", "1. " dari teks opsi sehingga hanya berisi teks opsi jawaban yang bersih.
5. Kunci Jawaban (correctAnswer):
   - Cari kunci jawaban yang ditandai dalam soal (misalnya jawaban bercetak tebal, tanda bintang '*', warna berbeda, digarisbawahi, atau di lembar 'Kunci Jawaban' pada akhir dokumen).
   - Jika kunci jawaban adalah huruf (misalnya 'B'), cocokkan dengan nilai opsi ke-2 tersebut sebagai teks correctAnswer.
   - Cantumkan correctOptionIndices (indeks array opsi yang benar, misal [1] untuk opsi B).
   - Jika dokumen tidak menyertakan kunci jawaban untuk soal tersebut, gunakan pengetahuan Anda untuk menentukan jawaban yang paling benar dan tepat secara akademis.
6. Berikan estimasi poin (points) untuk setiap soal (default 10).
7. Sediakan penjelasan ringkas (explanation) mengenai alasan jawaban tersebut benar.
8. ${userPrompt ? `Instruksi tambahan pengguna: ${userPrompt}` : ''}
`;

    let contents: any[] = [];

    if (isPdf && cleanBase64 && (!extractedText || extractedText.length < 50)) {
      contents = [
        {
          role: 'user',
          parts: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: cleanBase64
              }
            },
            {
              text: 'Silakan analisis dokumen PDF ujian di atas dan kembalikan seluruh soal yang ditemukan dalam format JSON sesuai skema yang ditentukan.'
            }
          ]
        }
      ];
    } else {
      const sourceText = extractedText.trim();
      if (sourceText) {
        contents = [
          {
            role: 'user',
            parts: [
              { text: systemPrompt },
              {
                text: `Berikut adalah teks materi ujian yang perlu diekstrak:\n\n${sourceText.slice(0, 50000)}`
              }
            ]
          }
        ];
      }
    }

    const quizSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Judul kuis atau nama ujian' },
        description: { type: Type.STRING, description: 'Petunjuk pengerjaan atau deskripsi formulir' },
        defaultPointsPerQuestion: { type: Type.NUMBER, description: 'Poin standar per soal (misal 10)' },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              number: { type: Type.NUMBER, description: 'Nomor urut soal' },
              text: { type: Type.STRING, description: 'Pertanyaan atau teks soal' },
              type: {
                type: Type.STRING,
                enum: ['MULTIPLE_CHOICE', 'CHECKBOX', 'SHORT_ANSWER', 'PARAGRAPH'],
                description: 'Tipe pertanyaan'
              },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Daftar pilihan jawaban tanpa prefix A/B/C/D'
              },
              correctAnswer: {
                type: Type.STRING,
                description: 'Nilai teks jawaban yang benar'
              },
              correctOptionIndices: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: 'Indeks (0-based) opsi yang benar'
              },
              points: { type: Type.NUMBER, description: 'Bobot nilai/poin soal' },
              explanation: { type: Type.STRING, description: 'Penjelasan atau pembahasan singkat' }
            },
            required: ['number', 'text', 'type', 'options', 'correctAnswer', 'points']
          }
        }
      },
      required: ['title', 'description', 'questions']
    };

    // Current active models prioritized per Google GenAI SDK standards
    const CANDIDATE_MODELS = [
      'gemini-3.8-flash',       // Primary recommended model for general text tasks
      'gemini-3.1-flash-lite',  // Fast, separate pool, high availability
      'gemini-flash-latest'     // Stable alias
    ];

    let response: any = null;
    let lastError: any = null;

    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

    if (ai && contents.length > 0) {
      modelLoop: for (const modelName of CANDIDATE_MODELS) {
        // Try up to 2 attempts per model with backoff on 503 / 429
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            response = await ai.models.generateContent({
              model: modelName,
              contents,
              config: {
                responseMimeType: 'application/json',
                responseSchema: attempt === 1 ? quizSchema : undefined
              }
            });
            if (response && response.text) {
              console.log(`[AI EXTRACTION] Succeeded using model ${modelName} (attempt ${attempt})`);
              break modelLoop;
            }
          } catch (err: any) {
            lastError = err;
            const errMsg = err?.message || String(err);
            const is503orRateLimit =
              errMsg.includes('503') ||
              errMsg.includes('high demand') ||
              errMsg.includes('UNAVAILABLE') ||
              errMsg.includes('429') ||
              errMsg.includes('RESOURCE_EXHAUSTED');

            console.warn(`Extraction with ${modelName} (attempt ${attempt}) notice:`, errMsg);

            if (is503orRateLimit && attempt < 2) {
              // Wait briefly for transient demand spike to clear
              await sleep(750 * attempt);
            } else {
              break; // Proceed to next candidate model
            }
          }
        }
      }
    }

    // If Gemini succeeded, parse structured JSON
    if (response && response.text) {
      try {
        const rawResponseText = response.text || '{}';
        const parsedData = parseGeminiJson(rawResponseText);

        const formattedQuestions = (parsedData.questions || []).map((q: any, idx: number) => {
          const questionId = `q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`;
          return {
            id: questionId,
            number: q.number || idx + 1,
            text: q.text || '',
            type: q.type || 'MULTIPLE_CHOICE',
            options: Array.isArray(q.options) ? q.options : [],
            correctAnswer: q.correctAnswer || (q.options && q.options[0]) || '',
            correctOptionIndices: Array.isArray(q.correctOptionIndices)
              ? q.correctOptionIndices
              : (q.options && q.correctAnswer ? [q.options.indexOf(q.correctAnswer)].filter((i: number) => i >= 0) : [0]),
            points: typeof q.points === 'number' ? q.points : defaultPoints,
            timeLimitMinutes: 1,
            explanation: q.explanation || ''
          };
        });

        if (formattedQuestions.length > 0) {
          const quizResult = {
            title: parsedData.title || (fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Kuis Baru'),
            description: parsedData.description || 'Silakan kerjakan soal-soal berikut dengan teliti.',
            defaultPointsPerQuestion: parsedData.defaultPointsPerQuestion || defaultPoints,
            securitySettings: {
              timePerQuestionMinutes: 1,
              enableAntiCheat: true,
              blockTabSwitch: true,
              blockBrowserSwitch: true,
              blockNewTabKeys: true,
              fullScreenEnforced: true,
              autoCloseOnViolation: true,
              sendEmailNotification: true,
              sendWhatsAppNotification: true
            },
            questions: formattedQuestions
          };

          return res.json({
            success: true,
            quizData: quizResult,
            totalQuestions: formattedQuestions.length
          });
        }
      } catch (parseErr) {
        console.warn('Gemini response JSON parsing failed, trying local fallback:', parseErr);
      }
    }

    // ZERO-DOWNTIME FALLBACK: If Gemini API had an outage or high demand, use intelligent local parser
    if (!extractedText && cleanBase64) {
      try {
        const decoded = Buffer.from(cleanBase64, 'base64').toString('utf-8');
        if (decoded && decoded.trim().length > 10) {
          extractedText = decoded.trim();
        }
      } catch (e) {
        // ignore
      }
    }

    if (extractedText && extractedText.trim().length > 0) {
      const localQuestions = parseQuestionsLocally(extractedText, defaultPoints);
      if (localQuestions.length > 0) {
        const formattedQuestions = localQuestions.map((q: any, idx: number) => ({
          id: `q_loc_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
          number: q.number || idx + 1,
          text: q.text || '',
          type: q.type || 'MULTIPLE_CHOICE',
          options: Array.isArray(q.options) ? q.options : [],
          correctAnswer: q.correctAnswer || (q.options && q.options[0]) || '',
          correctOptionIndices: Array.isArray(q.correctOptionIndices) ? q.correctOptionIndices : [0],
          points: typeof q.points === 'number' ? q.points : defaultPoints,
          timeLimitMinutes: 1,
          explanation: q.explanation || 'Diekstrak menggunakan parser lokal.'
        }));

        const quizResult = {
          title: fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Kuis Baru',
          description: 'Silakan kerjakan soal-soal berikut dengan teliti.',
          defaultPointsPerQuestion: defaultPoints,
          securitySettings: {
            timePerQuestionMinutes: 1,
            enableAntiCheat: true,
            blockTabSwitch: true,
            blockBrowserSwitch: true,
            blockNewTabKeys: true,
            fullScreenEnforced: true,
            autoCloseOnViolation: true,
            sendEmailNotification: true,
            sendWhatsAppNotification: true
          },
          questions: formattedQuestions
        };

        return res.json({
          success: true,
          fallbackUsed: true,
          quizData: quizResult,
          totalQuestions: formattedQuestions.length,
          message: 'Soal berhasil diekstrak melalui parser dokumen cerdas cadangan.'
        });
      }
    }

    // If both AI and local parsing could not find questions
    return res.status(422).json({
      error: 'Tidak dapat menemukan butir soal yang valid dalam dokumen ini.',
      details: lastError?.message || 'Format naskah soal tidak terdeteksi atau dokumen kosong.',
      suggestion: 'Pastikan file soal memiliki nomor soal (misal: 1., 2.) dan opsi jawaban (A., B., C.), atau salin dan tempelkan teks langsung pada tab "Tempel Teks Soal".'
    });
  } catch (error: any) {
    console.error('Extraction error:', error);
    res.status(500).json({
      error: 'Terjadi kendala saat memproses dokumen.',
      details: error.message || 'Kesalahan pada server'
    });
  }
});

async function startServer() {
  // Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
