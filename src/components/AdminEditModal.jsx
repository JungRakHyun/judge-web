import React, { useState } from 'react';
import { Edit, X } from 'lucide-react';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { regionMapping } from '../utils';

export default function AdminEditModal({ judge, onClose, showToast }) {
  const [editForm, setEditForm] = useState({ ...judge });

  const handleUpdateJudge = async () => {
    try {
      const judgeRef = doc(db, "judges", judge.id);
      await updateDoc(judgeRef, {
        name: editForm.name, title: editForm.title, region: editForm.region, court: editForm.court,
        department: editForm.department, career: editForm.career, ai_summary: editForm.ai_summary,
        win_rate: Number(editForm.win_rate), lose_rate: Number(editForm.lose_rate), draw_rate: Number(editForm.draw_rate)
      });
      showToast("판사 정보가 성공적으로 수정되었습니다.");
      onClose();
    } catch (error) { showToast("수정 중 오류가 발생했습니다.", "error"); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto custom-scrollbar">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2"><Edit className="text-indigo-600" size={18}/> 판사 정보 수정</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-[10px] font-bold text-slate-600 mb-1">이름</label><input type="text" className="w-full p-2 bg-slate-50 border rounded-lg text-[12px] outline-none" value={editForm.name} onChange={e=>setEditForm({...editForm, name: e.target.value})} /></div>
            <div><label className="block text-[10px] font-bold text-slate-600 mb-1">직급</label><select className="w-full p-2 bg-slate-50 border rounded-lg text-[12px] outline-none" value={editForm.title} onChange={e=>setEditForm({...editForm, title: e.target.value})}><option>판사</option><option>부장판사</option><option>수석부장판사</option><option>법원장</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-[10px] font-bold text-slate-600 mb-1">지역</label><select className="w-full p-2 bg-slate-50 border rounded-lg text-[12px] outline-none" value={editForm.region} onChange={e=>setEditForm({...editForm, region: e.target.value})}>{Object.values(regionMapping).filter((v,i,a)=>a.indexOf(v)===i).map(r=><option key={r} value={r}>{r}</option>)}</select></div>
            <div><label className="block text-[10px] font-bold text-slate-600 mb-1">법원</label><input type="text" className="w-full p-2 bg-slate-50 border rounded-lg text-[12px] outline-none" value={editForm.court} onChange={e=>setEditForm({...editForm, court: e.target.value})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-[10px] font-bold text-slate-600 mb-1">부서</label><input type="text" className="w-full p-2 bg-slate-50 border rounded-lg text-[12px] outline-none" value={editForm.department} onChange={e=>setEditForm({...editForm, department: e.target.value})} /></div>
            <div><label className="block text-[10px] font-bold text-slate-600 mb-1">경력</label><input type="text" className="w-full p-2 bg-slate-50 border rounded-lg text-[12px] outline-none" value={editForm.career} onChange={e=>setEditForm({...editForm, career: e.target.value})} /></div>
          </div>
          <div className="bg-indigo-50/50 p-2 rounded-xl border border-indigo-100">
            <label className="block text-[10px] font-bold text-indigo-800 mb-2">성향 (%)</label>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[9px] text-slate-500">원고승</label><input type="number" className="w-full p-1.5 border rounded text-[11px]" value={editForm.win_rate} onChange={e=>setEditForm({...editForm, win_rate: e.target.value})} /></div>
              <div><label className="text-[9px] text-slate-500">피고승</label><input type="number" className="w-full p-1.5 border rounded text-[11px]" value={editForm.lose_rate} onChange={e=>setEditForm({...editForm, lose_rate: e.target.value})} /></div>
              <div><label className="text-[9px] text-slate-500">조정</label><input type="number" className="w-full p-1.5 border rounded text-[11px]" value={editForm.draw_rate} onChange={e=>setEditForm({...editForm, draw_rate: e.target.value})} /></div>
            </div>
          </div>
          <div><label className="block text-[10px] font-bold text-slate-600 mb-1">AI 요약 정보</label><textarea className="w-full p-2 bg-slate-50 border rounded-lg text-[12px] outline-none resize-none h-20" value={editForm.ai_summary || ''} onChange={e=>setEditForm({...editForm, ai_summary: e.target.value})} /></div>
          <button onClick={handleUpdateJudge} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-colors text-[13px] shadow-sm mt-2">정보 수정 완료</button>
        </div>
      </div>
    </div>
  );
}