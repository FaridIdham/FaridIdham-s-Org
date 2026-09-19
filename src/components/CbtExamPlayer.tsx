import React, { useState, useEffect, useRef } from 'react';
import { QuizData, ExamSecuritySettings, Question, CheatingIncident } from '../types';
import {
  Clock,
  ShieldAlert,
  AlertTriangle,
  Send,
  CheckCircle,
  XCircle,
  ExternalLink,
  Smartphone,
  Mail,
  Maximize2,
  Lock,
  ArrowRight,
  ArrowLeft,
  Flame,
  Award,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CheckCircle2,
  HelpCircle,
  GraduationCap,
  User
} from 'lucide-react';
import {
  reportCheatingIncident,
  formatWhatsAppViolationMessage,
  createWhatsAppDirectUrl,
  getExamAttempts,
  incrementExamAttempt,
  resetExamAttempts
} from '../services/antiCheat';
import { sendCheatingViolationNotification } from '../services/gmail';
import { getAccessToken } from '../services/firebase';

interface CbtExamPlayerProps {
  quizData: QuizData;
  settings: ExamSecuritySettings;
  onExitExam: () => void;
  userEmail?: string;
  accessToken?: string;
}

export const CbtExamPlayer: React.FC<CbtExamPlayerProps> = ({
  quizData,
  settings,
  onExitExam,
  userEmail,
  accessToken
}) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, string | string[]>>({});
  
  // Dynamic countdown per question based on question configuration or settings
  const getTimeLimitForQuestion = (qIndex: number) => {
    const q = quizData.questions[qIndex];
    return (q?.timeLimitMinutes || settings.timePerQuestionMinutes || 1) * 60;
  };

  const activeQuestionTimeLimit = getTimeLimitForQuestion(currentQuestionIndex);
  const [timeLeft, setTimeLeft] = useState<number>(() => getTimeLimitForQuestion(0));
  const [isExamCompleted, setIsExamCompleted] = useState<boolean>(false);
  const [isTerminated, setIsTerminated] = useState<boolean>(false);
  const [incident, setIncident] = useState<CheatingIncident | null>(null);
  const [isSendingReport, setIsSendingReport] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [examStarted, setExamStarted] = useState<boolean>(false);
  const [showReview, setShowReview] = useState<boolean>(false);

  const maxAllowedAttempts = settings.maxAttempts || 2;
  const [attemptCount, setAttemptCount] = useState<number>(() => getExamAttempts(quizData.title));

  const [studentName, setStudentName] = useState<string>(settings.studentName || '');
  const [studentNim, setStudentNim] = useState<string>(settings.studentNim || '');
  const [mataKuliah, setMataKuliah] = useState<string>(quizData.mataKuliah || quizData.title || '');
  const [kelas, setKelas] = useState<string>(quizData.kelas || settings.studentClass || '');
  const [semester, setSemester] = useState<string>(quizData.semester || settings.studentSemester || '');

  const containerRef = useRef<HTMLDivElement>(null);
  const currentQRef = useRef<number>(currentQuestionIndex);
  currentQRef.current = currentQuestionIndex;
  
  const isTerminatedRef = useRef<boolean>(isTerminated);
  isTerminatedRef.current = isTerminated;

  const currentQuestion: Question | undefined = quizData.questions[currentQuestionIndex];
  const totalQuestions = quizData.questions.length;

  // Finish exam and record attempt
  const handleFinishExam = () => {
    setIsExamCompleted(true);
    const newAttempt = incrementExamAttempt(quizData.title);
    setAttemptCount(newAttempt);
  };

  // Retry exam if attempts remain
  const handleRetryExam = () => {
    if (attemptCount >= maxAllowedAttempts) return;
    setIsExamCompleted(false);
    setIsTerminated(false);
    setCurrentQuestionIndex(0);
    setStudentAnswers({});
    setShowReview(false);
    setTimeLeft(getTimeLimitForQuestion(0));
    setExamStarted(true);
  };

  // Reset attempts (for testing/educator)
  const handleResetAttempts = () => {
    resetExamAttempts(quizData.title);
    setAttemptCount(0);
    setIsExamCompleted(false);
    setExamStarted(false);
    setStudentAnswers({});
  };

  // Request fullscreen
  const requestFullScreenMode = async () => {
    try {
      if (containerRef.current && !document.fullscreenElement) {
        await containerRef.current.requestFullscreen().catch(() => {});
        setIsFullscreen(true);
      }
    } catch (e) {
      console.warn('Fullscreen request bypassed:', e);
    }
  };

  // Start exam handler
  const handleStartExam = async () => {
    setExamStarted(true);
    setTimeLeft(getTimeLimitForQuestion(0));
    await requestFullScreenMode();
  };

  // Trigger Cheating Incident & Auto-Close
  const triggerCheatingViolation = async (reason: string) => {
    if (isTerminatedRef.current || isExamCompleted) return;

    // Immediately lock out and terminate the exam session!
    setIsTerminated(true);

    const qNum = (currentQRef.current || 0) + 1;
    const nowTime = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    const effectiveStudentName = studentName || settings.studentName || 'Peserta Mahasiswa';
    const effectiveStudentNim = studentNim || settings.studentNim;
    const targetEmail = settings.studentEmail || settings.supervisorEmail || userEmail;
    const targetWhatsApp = settings.studentWhatsApp || settings.supervisorWhatsApp;

    setIsSendingReport(true);

    let emailSent = false;
    let whatsappUrl: string | undefined;

    try {
      // 1. Send via server incident reporter & format WhatsApp URL
      const reportRes = await reportCheatingIncident({
        studentName: effectiveStudentName,
        studentNim: effectiveStudentNim,
        studentEmail: targetEmail,
        studentWhatsApp: targetWhatsApp,
        quizTitle: mataKuliah || quizData.title,
        questionNumber: qNum,
        violationReason: reason,
        timestamp: nowTime
      });

      whatsappUrl = reportRes.whatsappUrl;

      // 2. Send via Gmail API if token available
      const token = accessToken || (await getAccessToken());
      if (token && targetEmail && settings.sendEmailNotification) {
        const emailRes = await sendCheatingViolationNotification({
          recipientEmail: targetEmail,
          studentName,
          quizTitle: quizData.title,
          violationReason: reason,
          questionNumber: qNum,
          timestamp: nowTime,
          accessToken: token
        });
        emailSent = emailRes.success;
      }
    } catch (err) {
      console.error('Failed to notify cheating incident:', err);
    } finally {
      setIsSendingReport(false);
    }

    const newIncident: CheatingIncident = {
      id: `incident_${Date.now()}`,
      timestamp: nowTime,
      studentName,
      studentEmail: targetEmail,
      studentWhatsApp: targetWhatsApp,
      quizTitle: quizData.title,
      questionNumber: qNum,
      reason,
      emailNotified: emailSent,
      whatsappNotified: !!whatsappUrl,
      whatsappUrl
    };

    setIncident(newIncident);
  };

  // Anti-cheat Event Listeners
  useEffect(() => {
    if (!examStarted || isTerminated || isExamCompleted) return;

    // 1. Tab switch & visibility change detector
    const handleVisibilityChange = () => {
      if (document.hidden && settings.blockTabSwitch) {
        triggerCheatingViolation(
          'Terdeteksi membuka tab baru atau berpindah ke aplikasi browser lain (Google Chrome, Firefox, Mozilla, Edge, dll).'
        );
      }
    };

    // 2. Window blur detector (switching windows/apps)
    const handleWindowBlur = () => {
      if (settings.blockBrowserSwitch) {
        triggerCheatingViolation(
          'Terdeteksi meninggalkan jendela ujian (berpindah ke browser lain atau aplikasi desktop).'
        );
      }
    };

    // 3. Key combination blocker (Ctrl+T, Ctrl+N, Alt+Tab, F12, etc)
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Block Ctrl+T (New Tab), Ctrl+N (New Window), Ctrl+W (Close Tab)
      if (isCtrlOrCmd && (e.key === 't' || e.key === 'T' || e.key === 'n' || e.key === 'N' || e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        e.stopPropagation();
        triggerCheatingViolation('Percobaan membuka tab baru atau jendela browser lain melalui shortcut keyboard.');
        return;
      }

      // Block F12 / Inspect
      if (e.key === 'F12' || (isCtrlOrCmd && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'C' || e.key === 'c'))) {
        e.preventDefault();
        e.stopPropagation();
        triggerCheatingViolation('Percobaan membuka Developer Tools / Inspect Element.');
        return;
      }

      // Block Alt+Tab
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        triggerCheatingViolation('Percobaan berpindah aplikasi menggunakan kombinasi tombol Alt+Tab.');
      }
    };

    // 4. Right-click context menu blocker
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // 5. Fullscreen change listener
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && settings.fullScreenEnforced) {
        setIsFullscreen(false);
        triggerCheatingViolation('Keluar dari mode layar penuh (Fullscreen) saat ujian berlangsung.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [examStarted, isTerminated, isExamCompleted, settings]);

  // Per-question countdown interval
  useEffect(() => {
    if (!examStarted || isTerminated || isExamCompleted) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Time expired for this question! Auto advance or finish
          if (currentQuestionIndex < totalQuestions - 1) {
            const nextIdx = currentQuestionIndex + 1;
            setCurrentQuestionIndex(nextIdx);
            return getTimeLimitForQuestion(nextIdx);
          } else {
            // Finished last question
            handleFinishExam();
            return 0;
          }
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [examStarted, isTerminated, isExamCompleted, currentQuestionIndex, totalQuestions]);

  // Answer selection handlers
  const handleSelectRadioOption = (opt: string) => {
    setStudentAnswers(prev => ({
      ...prev,
      [currentQuestionIndex]: opt
    }));
  };

  const handleToggleCheckboxOption = (opt: string) => {
    const current = (studentAnswers[currentQuestionIndex] as string[]) || [];
    let updated: string[];
    if (current.includes(opt)) {
      updated = current.filter(o => o !== opt);
    } else {
      updated = [...current, opt];
    }
    setStudentAnswers(prev => ({
      ...prev,
      [currentQuestionIndex]: updated
    }));
  };

  const handleTextAnswer = (text: string) => {
    setStudentAnswers(prev => ({
      ...prev,
      [currentQuestionIndex]: text
    }));
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < totalQuestions - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      setTimeLeft(getTimeLimitForQuestion(nextIdx));
    } else {
      handleFinishExam();
    }
  };

  const handlePrevQuestion = () => {
    if (currentQuestionIndex > 0) {
      const prevIdx = currentQuestionIndex - 1;
      setCurrentQuestionIndex(prevIdx);
      setTimeLeft(getTimeLimitForQuestion(prevIdx));
    }
  };

  // Format MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercentage = ((activeQuestionTimeLimit - timeLeft) / activeQuestionTimeLimit) * 100;
  const isUrgent = timeLeft <= 60;
  const isWarning = timeLeft <= 120 && timeLeft > 60;

  // SCREEN 1: PRE-EXAM BRIEFING OR BLOCKED IF EXCEEDED ATTEMPTS
  if (!examStarted) {
    if (attemptCount >= maxAllowedAttempts) {
      return (
        <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6">
          <div className="bg-white rounded-3xl border-2 border-amber-400 shadow-2xl overflow-hidden p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 mx-auto flex items-center justify-center">
              <Lock className="w-9 h-9" />
            </div>
            <div>
              <span className="inline-block px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full mb-2">
                Batas Respon Tercapai (Maksimal {maxAllowedAttempts}x)
              </span>
              <h1 className="text-2xl font-black text-slate-900">
                Akses Ujian Telah Ditutup
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-2 max-w-md mx-auto leading-relaxed">
                Ketentuan ujian menetapkan: <strong>hanya bisa mengulangi 2 kali memberikan respon jawaban</strong>. Anda telah menggunakan {attemptCount} kesempatan respon untuk ujian ini.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 text-left space-y-2">
              <div className="font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Informasi Hasil & Penilaian:</span>
              </div>
              <p className="text-amber-900 text-[11px] leading-relaxed">
                Seluruh respon dan skor Anda telah dicatat oleh pengajar. Jika pengajar ingin mereset sesi ini untuk keperluan simulasi ulang, gunakan tombol di bawah.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onExitExam}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs"
              >
                Kembali ke Dashboard
              </button>
              <button
                type="button"
                onClick={handleResetAttempts}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset Sesi Percobaan (Mode Guru)</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 px-8 py-8 text-white text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white/20 text-white backdrop-blur-xs mb-3">
              <ShieldAlert className="w-4 h-4" />
              Portal Ujian Terproteksi (Anti-Cheat & Batas Respon)
            </span>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{quizData.title}</h1>
            <p className="text-xs sm:text-sm text-red-100 mt-2 max-w-xl mx-auto">
              Simulasi Ujian CBT dengan waktu 1 menit per butir soal, maksimal 2 kali respon, dan proteksi anti-kecurangan aktif.
            </p>
          </div>

          <div className="p-8 space-y-6">
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-red-900">
              <div className="flex items-center gap-2 font-bold text-red-950 mb-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <span>PERATURAN KETAT INTEGRITAS UJIAN</span>
              </div>
              <ul className="text-xs space-y-2 text-red-800 list-disc pl-5">
                <li>
                  <strong>Waktu Pengerjaan Setiap Nomor:</strong> Dibatasi tepat{' '}
                  <span className="underline font-black">{settings.timePerQuestionMinutes || 1} Menit Hitung Mundur</span>.
                  Jika waktu habis, sistem otomatis berpindah ke nomor berikutnya.
                </li>
                <li>
                  <strong>Batas Respon:</strong> Hanya bisa mengulangi <strong>2 kali</strong> memberikan respon jawaban. Kesempatan saat ini: <strong className="text-red-950">Percobaan ke-{attemptCount + 1} dari {maxAllowedAttempts} kali</strong>.
                </li>
                <li>
                  <strong>Hasil Skor:</strong> Nilai, akurasi, dan pembahasan jawaban akan langsung ditampilkan seketika setelah seluruh soal selesai.
                </li>
                <li>
                  <strong>Larangan Membuka Browser / Tab Lain:</strong> Anda dilarang keras membuka tab baru atau berpindah ke aplikasi browser lain (Google, Mozilla, Edge).
                </li>
                <li>
                  <strong>Auto-Close Form:</strong> Jika sistem mendeteksi perpindahan tab atau browser lain, ujian akan <strong>OTOMATIS MENUTUP SENDIRI SEKETIKA</strong>.
                </li>
              </ul>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <span className="text-[11px] text-slate-500 block">Total Soal</span>
                <span className="text-lg font-extrabold text-slate-900">{totalQuestions} Nomor</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <span className="text-[11px] text-slate-500 block">Waktu / Nomor</span>
                <span className="text-lg font-extrabold text-indigo-600">{settings.timePerQuestionMinutes || 1} Menit</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <span className="text-[11px] text-slate-500 block">Kesempatan Respon</span>
                <span className="text-sm font-extrabold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full inline-block mt-1">
                  Ke-{attemptCount + 1} / {maxAllowedAttempts} Max
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <span className="text-[11px] text-slate-500 block">Auto-Close</span>
                <span className="text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full inline-block mt-1">
                  Instan
                </span>
              </div>
            </div>

            {/* Form Input Identitas Mahasiswa */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 font-bold text-slate-800 text-xs">
                <GraduationCap className="w-4 h-4 text-indigo-600" />
                <span>DATA IDENTITAS MAHASISWA & MATA KULIAH</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Data identitas ini dicatat pada lembar pengerjaan ujian dan rekapitulasi penilaian.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Nama Mahasiswa
                  </label>
                  <input
                    type="text"
                    value={studentName}
                    onChange={e => setStudentName(e.target.value)}
                    placeholder="Contoh: Ahmad Fauzi"
                    className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    NIM (Nomor Induk Mahasiswa)
                  </label>
                  <input
                    type="text"
                    value={studentNim}
                    onChange={e => setStudentNim(e.target.value)}
                    placeholder="Contoh: 211011400123"
                    className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Mata Kuliah
                  </label>
                  <input
                    type="text"
                    value={mataKuliah}
                    onChange={e => setMataKuliah(e.target.value)}
                    placeholder="Contoh: Pemrograman Web"
                    className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden transition"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Kelas
                    </label>
                    <input
                      type="text"
                      value={kelas}
                      onChange={e => setKelas(e.target.value)}
                      placeholder="Contoh: TI-3A"
                      className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Semester
                    </label>
                    <input
                      type="text"
                      value={semester}
                      onChange={e => setSemester(e.target.value)}
                      placeholder="Contoh: 4"
                      className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-xl p-2.5 focus:ring-2 focus:ring-indigo-500 outline-hidden transition"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onExitExam}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition"
              >
                Kembali ke Editor
              </button>

              <button
                type="button"
                onClick={handleStartExam}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-bold text-sm shadow-lg shadow-rose-200 transition active:scale-98"
              >
                <Maximize2 className="w-4 h-4" />
                <span>Saya Memahami & Mulai Ujian</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 2: TERMINATED / CHEATING DETECTED SCREEN (FORM CLOSED AUTOMATICALLY)
  if (isTerminated) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6 animate-shake">
        <div className="bg-white rounded-3xl border-2 border-red-500 shadow-2xl overflow-hidden">
          {/* Header Locked Banner */}
          <div className="bg-red-600 px-6 py-6 text-white text-center">
            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-xs mx-auto flex items-center justify-center mb-3">
              <XCircle className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl font-black uppercase tracking-wider">
              UJIAN DIHENTIKAN OTOMATIS
            </h1>
            <p className="text-sm font-semibold text-red-100 mt-1">
              AKSES FORMULIR TELAH DITUTUP KARENA TERDETEKSI KECURANGAN
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <div className="bg-red-50 border-l-4 border-red-600 p-4 rounded-r-xl">
              <p className="text-sm font-bold text-red-950">
                Peringatan Resmi Sistem:
              </p>
              <p className="text-xs text-red-800 mt-1 leading-relaxed">
                Anda telah melakukan kecurangan dalam hal menjawab soal. Sesuai ketentuan pengawasan ujian, formulir ujian telah otomatis ditutup sendiri dan pengerjaan Anda didiskualifikasi.
              </p>
            </div>

            {/* Incident Audit Details */}
            {incident && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Rincian Pelanggaran yang Dicatat Sistem:
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-slate-500">Ujian:</div>
                  <div className="font-semibold text-slate-900">{incident.quizTitle}</div>

                  <div className="text-slate-500">Nomor Soal:</div>
                  <div className="font-bold text-red-600">Nomor #{incident.questionNumber}</div>

                  <div className="text-slate-500">Waktu Terdeteksi:</div>
                  <div className="font-semibold text-slate-900">{incident.timestamp}</div>

                  <div className="text-slate-500">Pelanggaran:</div>
                  <div className="font-bold text-red-700 col-span-2 bg-red-100/70 p-2 rounded-lg mt-1">
                    {incident.reason}
                  </div>
                </div>
              </div>
            )}

            {/* Notification Status Badges */}
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Mail className="w-5 h-5 text-indigo-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-indigo-950">Notifikasi Email Pelanggaran</p>
                    <p className="text-[11px] text-indigo-700">
                      Telah dikirim dengan subjek: <em>"Anda telah melakukan kecurangan dalam hal menjawab soal"</em>
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-200 text-indigo-900">
                  Terkirim
                </span>
              </div>

              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-emerald-950">Notifikasi WhatsApp Pelanggaran</p>
                    <p className="text-[11px] text-emerald-700">
                      Pesan peringatan kecurangan resmi telah disiapkan untuk dikirim ke nomor WhatsApp terkait.
                    </p>
                  </div>
                </div>
                {incident?.whatsappUrl && (
                  <a
                    href={incident.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs"
                  >
                    <span>Buka WhatsApp</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={onExitExam}
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
              >
                Selesai & Keluar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 3: EXAM COMPLETED - DETAILED SCORE & ATTEMPTS REVIEW
  if (isExamCompleted) {
    let totalPossiblePoints = 0;
    let totalEarnedPoints = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const questionResults = quizData.questions.map((q, idx) => {
      const ans = studentAnswers[idx];
      const points = Math.max(0, Math.round(q.points ?? 10));
      totalPossiblePoints += points;

      const isUnanswered =
        ans === undefined ||
        ans === '' ||
        (Array.isArray(ans) && ans.length === 0);

      let isCorrect = false;

      if (!isUnanswered) {
        if (q.type === 'MULTIPLE_CHOICE') {
          const expectedText = q.correctAnswer;
          const expectedIndex = q.correctOptionIndices?.[0];
          if (typeof ans === 'string') {
            if (expectedText && ans.trim().toLowerCase() === expectedText.trim().toLowerCase()) {
              isCorrect = true;
            } else if (expectedIndex !== undefined && q.options[expectedIndex] === ans) {
              isCorrect = true;
            }
          }
        } else if (q.type === 'CHECKBOX') {
          const studentArr = Array.isArray(ans) ? [...ans].sort() : [];
          const correctArr = (q.correctOptionIndices || [])
            .map(i => q.options[i])
            .filter(Boolean)
            .sort();
          if (
            studentArr.length > 0 &&
            studentArr.length === correctArr.length &&
            studentArr.every((val, i) => val === correctArr[i])
          ) {
            isCorrect = true;
          }
        } else {
          // Short answer / paragraph
          if (
            typeof ans === 'string' &&
            q.correctAnswer &&
            ans.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
          ) {
            isCorrect = true;
          }
        }
      }

      if (isCorrect) {
        totalEarnedPoints += points;
        correctCount++;
      } else if (isUnanswered) {
        unansweredCount++;
      } else {
        wrongCount++;
      }

      return {
        q,
        idx,
        studentAnswer: ans,
        isCorrect,
        isUnanswered,
        pointsAwarded: isCorrect ? points : 0,
        pointsPossible: points
      };
    });

    const scorePercentage =
      totalPossiblePoints > 0
        ? Math.round((totalEarnedPoints / totalPossiblePoints) * 100)
        : 0;
    const isPassed = scorePercentage >= 70;
    const canRetry = attemptCount < maxAllowedAttempts;

    return (
      <div className="max-w-2xl mx-auto py-10 px-4 sm:px-6">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          {/* Header Score Card */}
          <div
            className={`px-8 py-8 text-white text-center ${
              isPassed
                ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-green-700'
                : 'bg-gradient-to-r from-amber-600 via-orange-600 to-red-600'
            }`}
          >
            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-xs mx-auto flex items-center justify-center mb-3">
              <Award className="w-9 h-9 text-white" />
            </div>
            <span className="inline-block px-3 py-1 bg-white/25 rounded-full text-xs font-bold uppercase tracking-wider mb-2">
              Hasil Skor Akhir Ujian
            </span>
            <div className="text-4xl sm:text-5xl font-black tracking-tight">
              {scorePercentage}
              <span className="text-2xl font-bold text-white/80"> / 100</span>
            </div>
            <p className="text-xs sm:text-sm text-white/90 mt-1 font-semibold">
              Perolehan Nilai: {totalEarnedPoints} dari {totalPossiblePoints} Poin Maksimal
            </p>
            <div className="mt-3">
              <span
                className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-black shadow-xs ${
                  isPassed
                    ? 'bg-white text-emerald-800'
                    : 'bg-white text-amber-900'
                }`}
              >
                {isPassed ? '✓ LULUS (KOMPETEN)' : '⚠ PERLU REMEDIAL'}
              </span>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Student & Course Academic Identity Card */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {studentName || 'Peserta Mahasiswa'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    NIM: <strong className="text-slate-800">{studentNim || '-'}</strong> • Mata Kuliah: <strong className="text-slate-800">{mataKuliah || quizData.title}</strong>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-slate-700">
                  Kelas: {kelas || '-'}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-slate-700">
                  Semester: {semester || '-'}
                </span>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200">
                <span className="text-emerald-700 font-semibold block text-[11px]">Jawaban Benar</span>
                <span className="text-xl font-black text-emerald-900">{correctCount}</span>
              </div>
              <div className="p-3 bg-red-50 rounded-2xl border border-red-200">
                <span className="text-red-700 font-semibold block text-[11px]">Jawaban Salah</span>
                <span className="text-xl font-black text-red-900">{wrongCount}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-slate-600 font-semibold block text-[11px]">Tidak Dijawab</span>
                <span className="text-xl font-black text-slate-800">{unansweredCount}</span>
              </div>
              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200">
                <span className="text-amber-800 font-semibold block text-[11px]">Batas Respon</span>
                <span className="text-base font-black text-amber-900">
                  Ke-{attemptCount} / {maxAllowedAttempts}
                </span>
              </div>
            </div>

            {/* Attempt Allowance Notice */}
            {canRetry ? (
              <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <RotateCcw className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-indigo-900">Masih Ada Kesempatan Mengulang:</strong>
                    <span className="text-indigo-700 text-[11px]">
                      Siswa hanya bisa mengulangi 2 kali memberikan respon. Anda masih memiliki {maxAllowedAttempts - attemptCount} kali kesempatan.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRetryExam}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs shrink-0 transition active:scale-98"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Ulangi Ujian (Sisa 1x)</span>
                </button>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <strong>Batas Respon Selesai:</strong> Anda telah menggunakan maksimal {maxAllowedAttempts} kali kesempatan respon. Skor terbaik Anda telah dicatat.
                </div>
              </div>
            )}

            {/* Toggle Review of Questions */}
            <div>
              <button
                type="button"
                onClick={() => setShowReview(prev => !prev)}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition"
              >
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-indigo-600" />
                  <span>Lihat Rincian Jawaban & Kunci Pembahasan ({totalQuestions} Nomor)</span>
                </div>
                {showReview ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showReview && (
                <div className="mt-3 space-y-3 max-h-80 overflow-y-auto pr-1">
                  {questionResults.map(res => (
                    <div
                      key={res.idx}
                      className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                        res.isCorrect
                          ? 'border-emerald-200 bg-emerald-50/40'
                          : res.isUnanswered
                          ? 'border-slate-200 bg-slate-50'
                          : 'border-red-200 bg-red-50/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-bold text-slate-900">
                          {res.idx + 1}. {res.q.text}
                        </span>
                        <span
                          className={`shrink-0 font-bold px-2 py-0.5 rounded-md text-[10px] ${
                            res.isCorrect
                              ? 'bg-emerald-200 text-emerald-900'
                              : 'bg-red-200 text-red-900'
                          }`}
                        >
                          {res.isCorrect ? `+${res.pointsAwarded} Poin` : '0 Poin'}
                        </span>
                      </div>

                      <div className="text-[11px] space-y-0.5 text-slate-600">
                        <div>
                          <strong className="text-slate-700">Jawaban Anda: </strong>
                          {res.studentAnswer
                            ? Array.isArray(res.studentAnswer)
                              ? res.studentAnswer.join(', ')
                              : res.studentAnswer
                            : '(Tidak dijawab)'}
                        </div>
                        <div>
                          <strong className="text-emerald-700">Kunci Jawaban: </strong>
                          {res.q.correctAnswer ||
                            res.q.options[res.q.correctOptionIndices?.[0] || 0] ||
                            '-'}
                        </div>
                        {res.q.explanation && (
                          <div className="text-indigo-800 bg-indigo-50/80 p-2 rounded-lg mt-1">
                            <strong>Pembahasan: </strong>
                            {res.q.explanation}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onExitExam}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs"
              >
                Kembali ke Dashboard / Editor
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SCREEN 4: ACTIVE EXAM WITH 5-MINUTE COUNTDOWN TIMER PER NUMBER
  return (
    <div ref={containerRef} className="min-h-[85vh] flex flex-col bg-slate-100/70 p-4 sm:p-6 select-none">
      <div className="max-w-4xl w-full mx-auto space-y-4">
        {/* Top Header Bar: Question Tracker & Per-Question 5-Minute Timer */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-black text-base flex items-center justify-center shadow-xs">
              {currentQuestionIndex + 1}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">
                  Nomor {currentQuestionIndex + 1} dari {totalQuestions}
                </span>
                <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-100">
                  {currentQuestion?.type === 'MULTIPLE_CHOICE'
                    ? 'Pilihan Ganda'
                    : currentQuestion?.type === 'CHECKBOX'
                    ? 'Kotak Centang'
                    : 'Esai / Uraian'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Bobot Nilai: {currentQuestion?.points || 10} Poin • Alokasi: {currentQuestion?.timeLimitMinutes || settings.timePerQuestionMinutes || 1} Menit
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {(studentName || mataKuliah) && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <GraduationCap className="w-3.5 h-3.5 text-indigo-600" />
                <span className="font-bold text-slate-800 truncate max-w-[140px]">
                  {studentName || 'Mahasiswa'}
                </span>
                {studentNim && (
                  <span className="text-slate-400 font-normal">({studentNim})</span>
                )}
                {kelas && (
                  <span className="px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-semibold text-slate-600">
                    {kelas}
                  </span>
                )}
              </div>
            )}

            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border font-mono transition-all ${
                isUrgent
                  ? 'bg-red-500 text-white border-red-600 animate-pulse shadow-md shadow-red-200'
                  : isWarning
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : 'bg-slate-900 text-white border-slate-800'
              }`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <div>
                <span className="text-xs block text-[10px] uppercase font-bold opacity-80 leading-none">
                  Waktu Nomor Ini:
                </span>
                <span className="text-lg font-black tracking-wider leading-none">
                  {formatTime(timeLeft)}
                </span>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
              <Lock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Anti-Cheat Aktif</span>
            </div>
          </div>
        </div>

        {/* Dynamic Countdown Progress Bar for the Current Question */}
        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              isUrgent ? 'bg-red-600' : isWarning ? 'bg-amber-500' : 'bg-indigo-600'
            }`}
            style={{ width: `${Math.max(0, 100 - progressPercentage)}%` }}
          />
        </div>

        {/* Question Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          {/* Question Text */}
          <div className="text-slate-900 font-medium text-base sm:text-lg leading-relaxed">
            {currentQuestion?.text}
          </div>

          {/* Answer Options according to type */}
          <div className="space-y-3 pt-2">
            {currentQuestion?.type === 'MULTIPLE_CHOICE' && (
              <div className="space-y-2.5">
                {currentQuestion.options.map((opt, idx) => {
                  const letter = String.fromCharCode(65 + idx);
                  const isSelected = studentAnswers[currentQuestionIndex] === opt;
                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectRadioOption(opt)}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-300 text-slate-600 bg-white'
                        }`}
                      >
                        {letter}
                      </div>
                      <span className="text-sm text-slate-800 flex-1 leading-normal">{opt}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {currentQuestion?.type === 'CHECKBOX' && (
              <div className="space-y-2.5">
                {currentQuestion.options.map((opt, idx) => {
                  const selectedArr = (studentAnswers[currentQuestionIndex] as string[]) || [];
                  const isChecked = selectedArr.includes(opt);
                  const letter = String.fromCharCode(65 + idx);
                  return (
                    <div
                      key={idx}
                      onClick={() => handleToggleCheckboxOption(opt)}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                        isChecked
                          ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${
                          isChecked
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-300 bg-white text-slate-600'
                        }`}
                      >
                        {isChecked && '✓'}
                      </div>
                      <span className="text-xs font-semibold text-slate-500 mr-1">{letter}.</span>
                      <span className="text-sm text-slate-800 flex-1 leading-normal">{opt}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {(currentQuestion?.type === 'SHORT_ANSWER' || currentQuestion?.type === 'PARAGRAPH') && (
              <div>
                <textarea
                  rows={currentQuestion.type === 'PARAGRAPH' ? 5 : 2}
                  value={(studentAnswers[currentQuestionIndex] as string) || ''}
                  onChange={e => handleTextAnswer(e.target.value)}
                  placeholder="Tuliskan jawaban Anda di sini..."
                  className="w-full rounded-xl border border-slate-300 p-3.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-hidden"
                />
              </div>
            )}
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <button
              type="button"
              disabled={currentQuestionIndex === 0}
              onClick={handlePrevQuestion}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold disabled:opacity-30 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Nomor Sebelumnya</span>
            </button>

            <button
              type="button"
              onClick={handleNextQuestion}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition active:scale-98"
            >
              <span>{currentQuestionIndex === totalQuestions - 1 ? 'Selesaikan Ujian' : 'Simpan & Nomor Berikutnya'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Live Proctoring Notice */}
        <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3 text-[11px] text-amber-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Pengawasan Aktif:</strong> Jangan membuka tab baru atau berpindah ke browser lain (Google, Firefox, Mozilla, Edge). Melanggar ketentuan akan otomatis menutup ujian sendiri!
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              triggerCheatingViolation(
                'Simulasi Pelanggaran: Membuka browser lain (Google Chrome/Firefox) atau tab baru.'
              )
            }
            className="text-[10px] text-red-600 underline font-semibold shrink-0 hover:text-red-800 ml-2"
          >
            [Uji Coba Deteksi Kecurangan]
          </button>
        </div>
      </div>
    </div>
  );
};
