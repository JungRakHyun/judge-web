import React, { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

export default function ReportModal({ review, judgeId, user, onClose, showToast }) {
  const [reportForm, setReportForm] = useState({ category: '욕설/비방', reason: '' });

  const submitReport = async () => {
    if (!reportForm.reason.trim()) return showToast("신고 사유를 간단히 적어주세요.", "error");
    try {
      await addDoc(collection(db, "reports"), {
        userId: user.uid, judgeId, reviewTimestamp: review.timestamp,
        reviewComment: review.comment, category: reportForm.category, 
        reason: reportForm.reason, reportedAt: new Date().toISOString(), status: '접수됨'
      });
      showToast("신고가 정상적으로 접수되었습니다.");
      onClose();
    } catch (error) { showToast("신고 접수 중 오류가 발생했습니다.", "error"); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-2xl animate-fade-in">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2"><Flag className="text-red-500" size={18}/> 리뷰 신고하기</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
        </div>
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
          <p className="text-[11px] text-slate-500 line-clamp-2">" {review.comment} "</p>
        </div>
        <label className="block text-[11px] font-bold text-slate-600 mb-1">신고 유형</label>
        <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-red-500 mb-3"
          value={reportForm.category} onChange={e=>setReportForm({...reportForm, category: e.target.value})}>
          <option>욕설/비방</option><option>광고/도배</option><option>허위사실 유포</option><option>기타</option>
        </select>
        <label className="block text-[11px] font-bold text-slate-600 mb-1">신고 사유</label>
        <textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-red-500 resize-none h-20 mb-4"
          placeholder="자세한 사유를 적어주세요." value={reportForm.reason} onChange={e=>setReportForm({...reportForm, reason: e.target.value})} />
        <button onClick={submitReport} className="w-full bg-red-500 text-white font-bold py-3 rounded-xl hover:bg-red-600 transition-colors text-[13px] shadow-sm">
          신고 접수하기
        </button>
      </div>
    </div>
  );
}