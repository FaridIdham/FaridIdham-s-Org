import React, { useState } from 'react';
import { ExamSecuritySettings } from '../types';
import {
  ShieldAlert,
  Clock,
  Lock,
  Mail,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  X,
  Smartphone,
  User,
  MonitorOff,
  Flame,
  RotateCcw
} from 'lucide-react';

interface ExamSecuritySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ExamSecuritySettings;
  onSave: (settings: ExamSecuritySettings) => void;
  onStartExam: () => void;
  quizTitle: string;
  totalQuestions: number;
}

export const ExamSecuritySettingsModal: React.FC<ExamSecuritySettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
  onStartExam,
  quizTitle,
  totalQuestions
}) => {
  const [formData, setFormData] = useState<ExamSecuritySettings>({
    ...settings,
    timePerQuestionMinutes: settings.timePerQuestionMinutes || 1,
    maxAttempts: settings.maxAttempts || 2,
    enableAntiCheat: settings.enableAntiCheat !== false,
    blockTabSwitch: settings.blockTabSwitch !== false,
    blockBrowserSwitch: settings.blockBrowserSwitch !== false,
    blockNewTabKeys: settings.blockNewTabKeys !== false,
    autoCloseOnViolation: settings.autoCloseOnViolation !== false,
    sendEmailNotification: settings.sendEmailNotification !== false,
    sendWhatsAppNotification: settings.sendWhatsAppNotification !== false
  });

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  const handleSaveAndLaunch = () => {
    onSave(formData);
    onClose();
    onStartExam();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header with High-Impact Warning Theme */}
        <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Pengaturan Waktu & Sistem Anti-Kecurangan</h2>
              <p className="text-xs text-red-100">
                Kontrol ketat 1 menit per nomor, proteksi browser, & auto-close Google Form
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Summary Box */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-amber-950">Aturan Pengawasan Aktif:</p>
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-amber-800">
                <li>Waktu per butir soal: <strong>{formData.timePerQuestionMinutes} Menit Hitung Mundur</strong>.</li>
                <li>Batas respon: <strong>Maksimal {formData.maxAttempts || 2} kali kesempatan mengirim jawaban</strong>.</li>
                <li>Dilarang membuka tab baru atau berpindah ke browser lain (Google, Firefox, Edge, dll).</li>
                <li>Jika melanggar: Formulir <strong>otomatis menutup sendiri</strong> seketika.</li>
                <li>Peringatan resmi dikirim ke <strong>Email & WhatsApp</strong>: <em>"Anda telah melakukan kecurangan dalam hal menjawab soal."</em></li>
              </ul>
            </div>
          </div>

          {/* Section 1: Waktu Pengerjaan Tiap Nomor */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">1. Alokasi Waktu Tiap Nomor</h3>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Lamanya Waktu Setiap Nomor (Hitung Mundur)
                </label>
                <p className="text-xs text-slate-500 mt-0.5">
                  Timer 1 menit akan berdetik mundur di setiap nomor. Jika waktu habis, jawaban tersimpan dan otomatis beralih ke nomor berikutnya.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={formData.timePerQuestionMinutes}
                  onChange={e =>
                    setFormData({
                      ...formData,
                      timePerQuestionMinutes: Math.max(1, parseInt(e.target.value) || 1)
                    })
                  }
                  className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-center font-bold text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs font-semibold text-slate-600">Menit / Soal</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 pl-1">
              * Total waktu maksimal untuk {totalQuestions} nomor: {formData.timePerQuestionMinutes * totalQuestions} menit.
            </p>
          </div>

          {/* Section: Batas Percobaan Respon */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-900">2. Batas Pengulangan Respon Jawaban</h3>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Maksimal Kesempatan Mengirim Respon
                </label>
                <p className="text-xs text-slate-500 mt-0.5">
                  Siswa hanya bisa mengulangi 2 kali memberikan respon jawaban. Percobaan ke-3 akan terkunci otomatis di CBT simulator.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={formData.maxAttempts || 2}
                  onChange={e =>
                    setFormData({
                      ...formData,
                      maxAttempts: Math.max(1, parseInt(e.target.value) || 2)
                    })
                  }
                  className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-center font-bold text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs font-semibold text-slate-600">Kali Respon</span>
              </div>
            </div>
          </div>

          {/* Section 3: Proteksi Browser & Tab */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-rose-600" />
              <h3 className="text-sm font-bold text-slate-900">3. Proteksi Akses Browser & Tab Baru</h3>
            </div>
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={formData.blockBrowserSwitch}
                  onChange={e => setFormData({ ...formData, blockBrowserSwitch: e.target.checked })}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 mt-0.5"
                />
                <div className="flex-1">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <MonitorOff className="w-3.5 h-3.5 text-rose-600" />
                    Kunci Akses Browser Lain (Google, Firefox, Edge, Mozilla, dll.)
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Mendeteksi saat kursor keluar dari jendela ujian atau saat aplikasi browser lain diaktifkan.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={formData.blockNewTabKeys}
                  onChange={e => setFormData({ ...formData, blockNewTabKeys: e.target.checked })}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 mt-0.5"
                />
                <div className="flex-1">
                  <span className="text-xs font-bold text-slate-800">
                    Blokir Buka Tab Baru & Tombol Pintas (Ctrl+T, Ctrl+N, Alt+Tab, F12)
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Mencegah membuka tab baru untuk browsing jawaban atau membuka developer tools.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-50 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={formData.autoCloseOnViolation}
                  onChange={e => setFormData({ ...formData, autoCloseOnViolation: e.target.checked })}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 mt-0.5"
                />
                <div className="flex-1">
                  <span className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-rose-600" />
                    Otomatis Menutup Formulir Sendiri Saat Melanggar Ketentuan
                  </span>
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    Ujian langsung dikunci dan ditutup seketika tanpa toleransi saat terjadi pelanggaran.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Section 3: Pengaturan Notifikasi Kecurangan */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">3. Notifikasi Pelanggaran (Email & WhatsApp)</h3>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.sendEmailNotification}
                    onChange={e => setFormData({ ...formData, sendEmailNotification: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <Mail className="w-3.5 h-3.5 text-indigo-600" />
                  Kirim Notifikasi Email
                </label>

                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.sendWhatsAppNotification}
                    onChange={e => setFormData({ ...formData, sendWhatsAppNotification: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                  Kirim Notifikasi WhatsApp
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <User className="w-3 h-3 text-slate-400" />
                    Nama Peserta Ujian
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Budi Santoso"
                    value={formData.studentName || ''}
                    onChange={e => setFormData({ ...formData, studentName: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Mail className="w-3 h-3 text-slate-400" />
                    Email Peserta / Siswa
                  </label>
                  <input
                    type="email"
                    placeholder="siswa@sekolah.sch.id"
                    value={formData.studentEmail || ''}
                    onChange={e => setFormData({ ...formData, studentEmail: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Smartphone className="w-3 h-3 text-emerald-600" />
                    Nomor WhatsApp Peserta / Orang Tua / Pengawas
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: 08123456789 atau 628123456789"
                    value={formData.studentWhatsApp || ''}
                    onChange={e => setFormData({ ...formData, studentWhatsApp: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Format otomatis diubah ke kode negara +62 untuk pengiriman pesan instan pelanggaran kecurangan.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition"
          >
            Batal
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-xs transition"
            >
              Simpan Pengaturan
            </button>

            <button
              type="button"
              onClick={handleSaveAndLaunch}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white text-xs font-bold shadow-md transition active:scale-98"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Mulai Ujian Terproteksi (CBT)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
