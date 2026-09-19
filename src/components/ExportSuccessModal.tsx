import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  Mail,
  FileSpreadsheet,
  ArrowRight,
  Sparkles,
  Share2,
  Puzzle,
  Clock,
  Timer,
  Sliders,
  Award,
  HelpCircle,
  RotateCcw
} from 'lucide-react';
import { QuizData } from '../types';
import { downloadCsvFile } from '../services/csvExport';
import { getSafeGoogleFormResponderUri } from '../services/googleForms';
import { FormAddonGuideModal } from './FormAddonGuideModal';
import { ScoreAndAttemptsGuideModal } from './ScoreAndAttemptsGuideModal';

interface ExportSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  formTitle: string;
  responderUri: string;
  editUri: string;
  emailSentTo?: string;
  emailStatus?: 'sent' | 'skipped' | 'failed';
  quizData: QuizData;
  onGoToDashboard: () => void;
}

export const ExportSuccessModal: React.FC<ExportSuccessModalProps> = ({
  isOpen,
  onClose,
  formTitle,
  responderUri,
  editUri,
  emailSentTo,
  emailStatus,
  quizData,
  onGoToDashboard
}) => {
  const [copiedLink, setCopiedLink] = useState<'responder' | 'edit' | 'responses' | null>(null);
  const [showAddonGuide, setShowAddonGuide] = useState<boolean>(false);
  const [showScoreGuide, setShowScoreGuide] = useState<boolean>(false);

  if (!isOpen) return null;

  const safeResponderUri = getSafeGoogleFormResponderUri(responderUri);
  const responsesUri = editUri ? editUri.replace(/\/edit(\?.*)?$/, '/edit#responses') : '';

  const totalEstimatedMinutes = quizData.questions.reduce(
    (acc, q) => acc + (q.timeLimitMinutes || quizData.securitySettings?.timePerQuestionMinutes || 1),
    0
  );

  const handleCopy = (text: string, type: 'responder' | 'edit') => {
    navigator.clipboard.writeText(text);
    setCopiedLink(type);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 text-center relative">
        {/* Success Icon */}
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4 ring-8 ring-emerald-50">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
          Formulir Google Berhasil Dibuat!
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-md mx-auto">
          Seluruh butir soal, pilihan jawaban, kunci jawaban, dan bobot nilai kuis telah sukses
          diunggah ke Google Forms Anda.
        </p>

        {/* Form Title & Stats */}
        <div className="my-5 p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span>JUDUL FORMULIR</span>
            <span>{quizData.questions.length} Butir Soal</span>
          </div>
          <p className="font-bold text-slate-900 text-sm">{formTitle}</p>

          {/* Email Notification Status */}
          {emailStatus === 'sent' && (
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-2 text-xs text-indigo-700 font-medium bg-indigo-50/70 p-2 rounded-xl">
              <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>
                Notifikasi email telah dikirim ke <strong>{emailSentTo}</strong>
              </span>
            </div>
          )}
          {emailStatus === 'failed' && (
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-2 text-xs text-amber-700 font-medium bg-amber-50 p-2 rounded-xl">
              <Mail className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Formulir dibuat, namun pengiriman email notifikasi gagal dikirim.</span>
            </div>
          )}
        </div>

        {/* Action Links */}
        <div className="space-y-3 mb-6 text-left">
          {/* Responder Link */}
          <div className="p-3.5 rounded-2xl border border-indigo-200 bg-indigo-50/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-bold text-indigo-800 uppercase tracking-wide block">
                Tautan Pengerjaan Kuis (Siswa / Responden)
              </span>
              <p className="text-xs text-slate-600 truncate mt-0.5">{safeResponderUri}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(safeResponderUri, 'responder')}
                className="p-2 bg-white hover:bg-slate-100 rounded-lg text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1 transition shadow-2xs"
              >
                {copiedLink === 'responder' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Disalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>Salin</span>
                  </>
                )}
              </button>
              <a
                href={safeResponderUri}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition shadow-xs"
              >
                <span>Buka</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Editor Link */}
          <div className="p-3.5 rounded-2xl border border-slate-200 bg-white flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide block">
                Tautan Editor Google Forms (Pengajar)
              </span>
              <p className="text-xs text-slate-500 truncate mt-0.5">{editUri}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(editUri, 'edit')}
                className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1 transition"
              >
                {copiedLink === 'edit' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Disalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>Salin</span>
                  </>
                )}
              </button>
              <a
                href={editUri}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition"
              >
                <span>Buka Editor</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Add-on Timer Recommendation Card */}
          <div className="p-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/90 to-orange-50/60 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-xl bg-amber-100 text-amber-700">
                  <Puzzle className="w-4 h-4" />
                </span>
                <span className="text-xs font-black text-amber-900 uppercase tracking-wide">
                  Aktifkan Add-on Timer di Google Forms
                </span>
              </div>
              <span className="text-[10px] font-bold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full">
                1 Menit / Soal
              </span>
            </div>
            <p className="text-xs text-amber-950/80 mt-2 leading-relaxed">
              Agar siswa melihat hitung mundur interaktif atau batas waktu otomatis di Google Forms, pasang add-on timer resmi:
            </p>
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <a
                href="https://workspace.google.com/marketplace/app/form_timer/620454808595"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-xl bg-white border border-amber-200 hover:border-amber-300 flex items-center justify-between gap-2 group transition shadow-2xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 truncate">Form Timer</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block truncate">Link Langsung Marketplace</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-indigo-600 shrink-0" />
              </a>

              <a
                href="https://workspace.google.com/marketplace/app/form_response_limit_form_limiter_formlim/636193074458"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-xl bg-white border border-amber-200 hover:border-amber-300 flex items-center justify-between gap-2 group transition shadow-2xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 truncate">formLimiter</span>
                  </div>
                  <span className="text-[10px] text-slate-500 block truncate">Link Langsung Marketplace</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-emerald-600 shrink-0" />
              </a>
            </div>

            <div className="mt-3 pt-2.5 border-t border-amber-200/70 flex items-center justify-between">
              <span className="text-[11px] text-amber-900">
                Cara 100% Berhasil: <strong>⋮ &rarr; Dapatkan add-on (Get add-ons)</strong>
              </span>
              <button
                type="button"
                onClick={() => setShowAddonGuide(true)}
                className="text-xs font-bold text-indigo-700 hover:text-indigo-900 underline inline-flex items-center gap-1"
              >
                <span>Lihat Panduan & Solusi Error</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Direct Responses & Score Viewing Card */}
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-xl bg-emerald-100 text-emerald-700">
                  <Award className="w-4 h-4" />
                </span>
                <span className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                  Hasil Skor & Batas 2 Kali Respon
                </span>
              </div>
              <span className="text-[10px] font-bold bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-full">
                Maksimal 2x Respon
              </span>
            </div>
            <p className="text-xs text-emerald-900/90 mt-2 leading-relaxed">
              <strong>Di mana melihat hasil skor?</strong> Guru dapat melihat rekap skor di <strong>Tab Respons</strong> Google Form atau Google Sheets. Siswa dapat melihat skor seketika melalui tombol <strong>Lihat Skor</strong> setelah submit.
            </p>
            <div className="mt-3 pt-2.5 border-t border-emerald-200/70 flex flex-wrap items-center justify-between gap-2">
              {responsesUri && (
                <a
                  href={responsesUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-2xs"
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>Buka Tab Respons & Skor Guru</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setShowScoreGuide(true)}
                className="text-xs font-bold text-emerald-800 hover:text-emerald-950 underline inline-flex items-center gap-1"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Panduan Lengkap Skor & 2x Respon</span>
              </button>
            </div>
          </div>
        </div>

        {/* Form Addon Guide Modal */}
        <FormAddonGuideModal
          isOpen={showAddonGuide}
          onClose={() => setShowAddonGuide(false)}
          editUri={editUri}
          totalDurationMinutes={totalEstimatedMinutes}
          questionCount={quizData.questions.length}
        />

        {/* Score and Attempts Guide Modal */}
        <ScoreAndAttemptsGuideModal
          isOpen={showScoreGuide}
          onClose={() => setShowScoreGuide(false)}
          responsesUri={responsesUri}
          editUri={editUri}
        />

        {/* Secondary options */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => downloadCsvFile(quizData)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold shadow-2xs transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Simpan Cadangan CSV</span>
          </button>

          <button
            type="button"
            onClick={onGoToDashboard}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition"
          >
            <span>Lihat di Dashboard Riwayat</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 text-xs font-semibold text-slate-400 hover:text-slate-600"
        >
          Tutup Jendela Ini
        </button>
      </div>
    </div>
  );
};
