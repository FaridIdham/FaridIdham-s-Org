import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { FileUploadStep } from './components/FileUploadStep';
import { QuestionEditor } from './components/QuestionEditor';
import { HistoryDashboard } from './components/HistoryDashboard';
import { PublishConfirmationModal } from './components/PublishConfirmationModal';
import { ExportSuccessModal } from './components/ExportSuccessModal';
import { CsvExportModal } from './components/CsvExportModal';
import { FormatGuideModal } from './components/FormatGuideModal';
import { CbtExamPlayer } from './components/CbtExamPlayer';
import { ExamSecuritySettingsModal } from './components/ExamSecuritySettingsModal';
import { DEFAULT_EXAM_SECURITY_SETTINGS } from './services/antiCheat';
import {
  QuizData,
  ConversionHistoryItem,
  UserProfile,
  ExamSecuritySettings
} from './types';
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  auth
} from './services/firebase';
import { createGoogleForm, getSafeGoogleFormResponderUri } from './services/googleForms';
import { sendQuizReadyNotification } from './services/gmail';
import { CheckCircle2, AlertCircle, Info, X, ShieldAlert, Play, FileCheck2 } from 'lucide-react';

const LOCAL_STORAGE_HISTORY_KEY = 'formquiz_history_v1';

export default function App() {
  // Navigation
  const [currentTab, setCurrentTab] = useState<'converter' | 'dashboard' | 'guide' | 'cbt-exam'>('converter');

  // Authentication State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Active Quiz State
  const [activeQuiz, setActiveQuiz] = useState<QuizData | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>('Dokumen Soal');
  const [currentFileType, setCurrentFileType] = useState<'docx' | 'pdf' | 'text' | 'sample'>('docx');
  const [isLoadingExtraction, setIsLoadingExtraction] = useState<boolean>(false);

  // Exam Security & Anti-Cheat Settings
  const [showSecurityModal, setShowSecurityModal] = useState<boolean>(false);
  const [examSecuritySettings, setExamSecuritySettings] = useState<ExamSecuritySettings>(DEFAULT_EXAM_SECURITY_SETTINGS);

  // Modals
  const [showPublishModal, setShowPublishModal] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [publishingStep, setPublishingStep] = useState<string>('');
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [lastPublishedResult, setLastPublishedResult] = useState<{
    formTitle: string;
    responderUri: string;
    editUri: string;
    emailSentTo?: string;
    emailStatus?: 'sent' | 'skipped' | 'failed';
  } | null>(null);
  const [showCsvModal, setShowCsvModal] = useState<boolean>(false);
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);

  const showNotification = (message: string, type: 'error' | 'success' | 'info' = 'error') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // History State
  const [history, setHistory] = useState<ConversionHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return (parsed || []).map((item: ConversionHistoryItem) => ({
        ...item,
        responderUri: getSafeGoogleFormResponderUri(item.responderUri, item.formId)
      }));
    } catch (e) {
      return [];
    }
  });

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.error('Failed to persist history to localStorage', e);
    }
  }, [history]);

  // Auth observer
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser({
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
          photoURL: currentUser.photoURL
        });
      },
      () => {
        // If current auth state is unknown or token expired
        if (auth.currentUser) {
          setUser({
            uid: auth.currentUser.uid,
            displayName: auth.currentUser.displayName,
            email: auth.currentUser.email,
            photoURL: auth.currentUser.photoURL
          });
        } else {
          setUser(null);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.profile);
        showNotification('Berhasil masuk dengan Google!', 'success');
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked') {
        showNotification('Jendela popup diblokir oleh browser. Izinkan popup atau buka aplikasi di tab baru.', 'error');
      } else {
        showNotification(`Gagal masuk dengan Google: ${err.message || 'Periksa izin popup browser Anda'}`, 'error');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      showNotification('Berhasil keluar dari akun Google.', 'info');
    } catch (err) {
      console.error('Logout error', err);
    }
  };

  // Called when AI or fallback finishes extracting questions from document
  const handleQuizExtracted = (
    quiz: QuizData,
    fileName: string,
    fileType: 'docx' | 'pdf' | 'text' | 'sample',
    fallbackNotice?: string
  ) => {
    const sanitizedQuiz: QuizData = {
      ...quiz,
      securitySettings: {
        ...DEFAULT_EXAM_SECURITY_SETTINGS,
        ...(quiz.securitySettings || {}),
        timePerQuestionMinutes: quiz.securitySettings?.timePerQuestionMinutes || 1
      },
      questions: (quiz.questions || []).map(q => ({
        ...q,
        timeLimitMinutes: q.timeLimitMinutes || 1
      }))
    };

    setActiveQuiz(sanitizedQuiz);
    setCurrentFileName(fileName);
    setCurrentFileType(fileType);
    setCurrentTab('converter');

    // Add draft entry to history
    const historyItem: ConversionHistoryItem = {
      id: `hist_${Date.now()}`,
      fileName,
      fileType,
      title: sanitizedQuiz.title,
      questionCount: sanitizedQuiz.questions.length,
      totalPoints: sanitizedQuiz.questions.reduce((acc, q) => acc + (q.points || 0), 0),
      createdAt: new Date().toISOString(),
      status: 'reviewing',
      quizData: sanitizedQuiz
    };

    setHistory(prev => [historyItem, ...prev.filter(h => h.id !== historyItem.id)]);
    if (fallbackNotice) {
      showNotification(`Berhasil mengekstrak ${quiz.questions.length} butir soal (${fallbackNotice})`, 'info');
    } else {
      showNotification(`Berhasil mengekstrak ${quiz.questions.length} butir soal dengan AI!`, 'success');
    }
  };

  // Open Publish Modal with auth validation
  const handleOpenPublishModal = () => {
    setShowPublishModal(true);
  };

  // Confirmed Google Form Creation
  const handleConfirmPublish = async (sendEmail: boolean) => {
    if (!activeQuiz) return;

    let token = await getAccessToken();
    if (!token) {
      try {
        const loginResult = await googleSignIn();
        if (loginResult) {
          token = loginResult.accessToken;
          setUser(loginResult.profile);
        } else {
          return;
        }
      } catch (err: any) {
        if (err?.code === 'auth/popup-blocked') {
          showNotification('Popup otorisasi diblokir. Harap izinkan popup atau buka aplikasi di tab baru.', 'error');
        } else {
          showNotification('Otorisasi Google diperlukan untuk membuat Google Form.', 'error');
        }
        return;
      }
    }

    setIsPublishing(true);
    setPublishingStep('1/3: Membuat Google Form baru di Google Drive Anda...');

    try {
      // Step 1: Create Form in Google Forms API
      const result = await createGoogleForm(activeQuiz, token);

      // Step 2: Automated Email notification if requested
      let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
      let emailSentTo = user?.email || undefined;

      if (sendEmail && emailSentTo) {
        setPublishingStep('2/3: Mengirim email notifikasi ringkasan kuis ke ' + emailSentTo + '...');
        const emailRes = await sendQuizReadyNotification({
          recipientEmail: emailSentTo,
          formTitle: result.title,
          formUrl: result.responderUri,
          editUrl: result.editUri,
          questionCount: result.totalQuestions,
          totalPoints: activeQuiz.questions.reduce((acc, q) => acc + (q.points || 0), 0),
          accessToken: token
        });

        emailStatus = emailRes.success ? 'sent' : 'failed';
      }

      setPublishingStep('3/3: Menyimpan status konversi ke dashboard riwayat...');

      // Step 3: Update conversion history
      const historyItem: ConversionHistoryItem = {
        id: `hist_${Date.now()}`,
        fileName: currentFileName,
        fileType: currentFileType,
        title: result.title,
        questionCount: result.totalQuestions,
        totalPoints: activeQuiz.questions.reduce((acc, q) => acc + (q.points || 0), 0),
        createdAt: new Date().toISOString(),
        status: 'uploaded_form',
        formId: result.formId,
        responderUri: result.responderUri,
        editUri: result.editUri,
        emailSentTo,
        emailStatus,
        quizData: activeQuiz
      };

      setHistory(prev => [historyItem, ...prev]);

      // Step 4: Show Success Modal
      setLastPublishedResult({
        formTitle: result.title,
        responderUri: result.responderUri,
        editUri: result.editUri,
        emailSentTo,
        emailStatus
      });

      setShowPublishModal(false);
      setShowSuccessModal(true);
    } catch (err: any) {
      console.error('Publish error:', err);
      showNotification(`Gagal membuat Google Form: ${err.message || 'Terjadi kesalahan pada Google Forms API'}`, 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleLoadIntoEditor = (item: ConversionHistoryItem) => {
    setActiveQuiz(item.quizData);
    setCurrentFileName(item.fileName);
    setCurrentFileType(item.fileType);
    setCurrentTab('converter');
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const handleClearHistory = () => {
    if (confirm('Apakah Anda yakin ingin menghapus semua riwayat konversi? Tindakan ini tidak dapat dibatalkan.')) {
      setHistory([]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 font-sans flex flex-col relative">
      {/* Global In-App Toast Notification */}
      {toast && (
        <div className="fixed top-20 right-6 z-50 max-w-md animate-fade-in shadow-xl rounded-2xl overflow-hidden border">
          <div
            className={`flex items-start gap-3 p-4 text-sm font-medium ${
              toast.type === 'error'
                ? 'bg-red-900 text-white border-red-700'
                : toast.type === 'success'
                ? 'bg-emerald-900 text-white border-emerald-700'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />}
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />}
            {toast.type === 'info' && <Info className="w-5 h-5 text-sky-300 shrink-0 mt-0.5" />}
            <span className="flex-1 text-xs leading-relaxed">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="text-white/70 hover:text-white transition shrink-0 ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={tab => {
          if (tab === 'guide') {
            setShowGuideModal(true);
          } else {
            setCurrentTab(tab);
          }
        }}
        user={user}
        onLogin={handleLogin}
        onLogout={handleLogout}
        isLoggingIn={isLoggingIn}
        activeQuestionsCount={activeQuiz?.questions.length || 0}
      />

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        {currentTab === 'converter' && (
          <>
            {!activeQuiz ? (
              <FileUploadStep
                onQuizExtracted={handleQuizExtracted}
                isLoading={isLoadingExtraction}
                setIsLoading={setIsLoadingExtraction}
              />
            ) : (
              <QuestionEditor
                quizData={activeQuiz}
                onChangeQuizData={setActiveQuiz}
                onOpenUploadNew={() => setActiveQuiz(null)}
                onOpenExportCsv={() => setShowCsvModal(true)}
                onOpenPublishModal={handleOpenPublishModal}
                onOpenSecuritySettings={() => setShowSecurityModal(true)}
                onStartExamSimulator={() => setCurrentTab('cbt-exam')}
                fileName={currentFileName}
              />
            )}
          </>
        )}

        {currentTab === 'dashboard' && (
          <HistoryDashboard
            history={history}
            onLoadIntoEditor={handleLoadIntoEditor}
            onDeleteHistoryItem={handleDeleteHistoryItem}
            onClearHistory={handleClearHistory}
            onStartNewConversion={() => {
              setActiveQuiz(null);
              setCurrentTab('converter');
            }}
          />
        )}

        {currentTab === 'cbt-exam' && (
          <div className="max-w-6xl mx-auto px-4 py-6">
            {activeQuiz ? (
              <CbtExamPlayer
                quizData={activeQuiz}
                settings={examSecuritySettings}
                onExitExam={() => setCurrentTab('converter')}
                userEmail={user?.email || undefined}
              />
            ) : (
              <div className="max-w-xl mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto ring-8 ring-rose-50">
                  <ShieldAlert className="w-9 h-9" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Ujian Terproteksi (CBT Anti-Cheat)</h2>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Pilih paket soal untuk memulai simulasi ujian dengan batas waktu 5 menit hitung mundur per nomor, proteksi browser, dan penutupan otomatis saat melanggar.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  {history.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleLoadIntoEditor(history[0]);
                        setCurrentTab('cbt-exam');
                      }}
                      className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-left transition"
                    >
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">
                          Gunakan Soal Terakhir: {history[0].title}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {history[0].questionCount} Butir Soal • {history[0].fileName}
                        </span>
                      </div>
                      <Play className="w-4 h-4 text-indigo-600 shrink-0" />
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/sample-quizzes');
                        const data = await res.json();
                        if (data && data.length > 0) {
                          handleQuizExtracted(data[0], 'Sample_Biologi_SMA.docx', 'sample');
                          setCurrentTab('cbt-exam');
                        }
                      } catch (e) {
                        setCurrentTab('converter');
                      }
                    }}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-bold text-xs shadow-md transition"
                  >
                    Muat Sampel Soal & Langsung Tes Ujian
                  </button>

                  <button
                    type="button"
                    onClick={() => setCurrentTab('converter')}
                    className="w-full py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition"
                  >
                    Unggah Dokumen Word / PDF Baru
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Security Settings Modal */}
      <ExamSecuritySettingsModal
        isOpen={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
        settings={examSecuritySettings}
        onSave={updated => {
          setExamSecuritySettings(updated);
          showNotification('Pengaturan waktu & sistem anti-kecurangan berhasil disimpan!', 'success');
        }}
        onStartExam={() => {
          setCurrentTab('cbt-exam');
        }}
        quizTitle={activeQuiz?.title || 'Ujian Online'}
        totalQuestions={activeQuiz?.questions.length || 0}
      />

      {/* Modals */}
      {activeQuiz && (
        <>
          <PublishConfirmationModal
            isOpen={showPublishModal}
            onClose={() => setShowPublishModal(false)}
            onConfirmPublish={handleConfirmPublish}
            quizData={activeQuiz}
            user={user}
            onNeedLogin={handleLogin}
            isLoggingIn={isLoggingIn}
            isPublishing={isPublishing}
            publishingStep={publishingStep}
          />

          <ExportSuccessModal
            isOpen={showSuccessModal}
            onClose={() => setShowSuccessModal(false)}
            formTitle={lastPublishedResult?.formTitle || activeQuiz.title}
            responderUri={lastPublishedResult?.responderUri || ''}
            editUri={lastPublishedResult?.editUri || ''}
            emailSentTo={lastPublishedResult?.emailSentTo}
            emailStatus={lastPublishedResult?.emailStatus}
            quizData={activeQuiz}
            onGoToDashboard={() => {
              setShowSuccessModal(false);
              setCurrentTab('dashboard');
            }}
          />

          <CsvExportModal
            isOpen={showCsvModal}
            onClose={() => setShowCsvModal(false)}
            quizData={activeQuiz}
          />
        </>
      )}

      <FormatGuideModal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
      />
    </div>
  );
}
