import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { 
  ChevronLeft, Share2, X, Bot, Star, ThumbsUp, Flag, MessageSquare, Heart, 
  Trash2, Edit2, CornerDownRight, Send 
} from 'lucide-react';
import { db } from '../firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { formatDate, getUserBadge } from '../utils';
import ReportModal from './ReportModal';

export default function JudgeDetailModal({ judge, allJudges, user, onClose, showToast, currentTab, selectedRegionName }) {
  const chartRef = useRef(null);
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(5);
  const [isKeyboardActive, setIsKeyboardActive] = useState(false);
  const [reportModalReview, setReportModalReview] = useState(null);

  const [editingReview, setEditingReview] = useState(null); 
  const [replyingTo, setReplyingTo] = useState(null); 
  const [replyText, setReplyText] = useState("");
  const [editingReply, setEditingReply] = useState(null); 

  const chartData = [
    { name: '원고 승소', value: judge?.win_rate || 33, itemStyle: { color: '#3B82F6' } },
    { name: '피고 승소', value: judge?.lose_rate || 33, itemStyle: { color: '#EF4444' } },
    { name: '조정/화해', value: judge?.draw_rate || 34, itemStyle: { color: '#10B981' } }
  ];

  const bookmarkedUsers = judge?.bookmarkedUsers || [];
  const isBookmarked = bookmarkedUsers.includes(user?.uid);

  useEffect(() => {
    let myChart = null;
    if (chartRef.current) {
      myChart = echarts.init(chartRef.current);
      myChart.setOption({
        tooltip: { trigger: 'item', backgroundColor: 'rgba(255, 255, 255, 0.95)', borderColor: '#e2e8f0', textStyle: { fontSize: 11, fontWeight: 'bold' } },
        series: [
          {
            type: 'pie', radius: ['45%', '70%'], avoidLabelOverlap: true,
            itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
            label: { show: true, formatter: '{d}%', fontWeight: 'bold', fontSize: 12, color: '#475569' },
            labelLine: { show: true, length: 5, length2: 5 },
            data: chartData
          }
        ]
      });
    }
    const handleResize = () => { if (myChart) myChart.resize(); };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); if (myChart) myChart.dispose(); };
  }, [judge]);

  const toggleBookmark = async () => {
    if (!user) return showToast("즐겨찾기를 하려면 먼저 로그인해주세요.", "error");
    try {
      const newBookmarks = isBookmarked ? bookmarkedUsers.filter(id => id !== user.uid) : [...bookmarkedUsers, user.uid];
      await updateDoc(doc(db, "judges", judge.id), { bookmarkedUsers: newBookmarks });
      showToast(isBookmarked ? "즐겨찾기에서 해제되었습니다." : "즐겨찾기에 추가되었습니다!");
    } catch (e) { showToast("즐겨찾기 처리 실패", "error"); }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?judgeId=${judge.id}`;
    const shareData = { title: `${judge.name} 판사 정보 - JUDGE MAP`, text: `${judge.court} 소속 ${judge.name} 판사의 판결 성향과 리뷰를 확인해보세요!`, url: shareUrl };
    if (navigator.share) { 
      try { await navigator.share(shareData); } catch (e) {} 
    } else { 
      navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`); 
      showToast("클립보드에 판사 전용 링크가 복사되었습니다!"); 
    }
  };

  // 💡 AI 요약 업데이트 함수 (조건을 1건 이상으로 변경)
  const updateAISummaryIfNeeded = async (currentReviews) => {
    const validReviews = currentReviews.filter(r => r && r.comment);
    
    // 🚨 기존 3건 이상에서 1건 이상(>= 1)으로 기준 하향 조절
    if (validReviews.length >= 1) {
      const ACTUAL_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY; 
      if (!ACTUAL_GEMINI_API_KEY) return;
      const prompt = `다음은 ${judge.name} 판사에 대한 리뷰입니다. 이 리뷰들의 공통적인 내용과 판사의 재판 성향을 3줄로 객관적으로 요약해주세요:\n\n${validReviews.map(r => r.comment).join("\n")}`;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${ACTUAL_GEMINI_API_KEY}`, { 
          method: "POST", headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) 
        });
        const data = await res.json();
        if (res.ok && data.candidates?.length > 0) {
          await updateDoc(doc(db, "judges", judge.id), { ai_summary: data.candidates[0].content.parts[0].text });
        }
      } catch (error) { console.error("AI 요약 실패", error); }
    } else {
      // 만약 리뷰를 삭제해서 0건이 되었다면 AI 요약도 비워줍니다.
      await updateDoc(doc(db, "judges", judge.id), { ai_summary: "" });
    }
  };

  const submitReview = async () => {
    if (!user) return showToast("리뷰를 작성하려면 먼저 로그인해주세요.", "error");
    if (!reviewText.trim()) return showToast("리뷰 내용을 입력해주세요.", "error");
    try {
      const updatedReviews = [...(judge.reviews || []), { rating, comment: reviewText, timestamp: new Date().toISOString(), userName: user.displayName || "익명", uid: user.uid, likes: 0, likedUsers: [], replies: [] }];
      await updateDoc(doc(db, "judges", judge.id), { reviews: arrayUnion(updatedReviews[updatedReviews.length-1]) });
      setReviewText(""); setIsKeyboardActive(false); showToast("소중한 리뷰가 등록되었습니다.");
      await updateAISummaryIfNeeded(updatedReviews);
    } catch (e) { showToast("리뷰 등록 실패", "error"); }
  };

  const submitEditReview = async (rev) => {
    if (!editingReview?.text?.trim()) return showToast("내용을 입력해주세요.", "error");
    try {
      const updatedReviews = (judge.reviews || []).map(r => {
        if (!r) return r;
        if (r.uid === rev.uid && r.timestamp === rev.timestamp) return { ...r, comment: editingReview.text, isEdited: true };
        return r;
      });
      await updateDoc(doc(db, "judges", judge.id), { reviews: updatedReviews });
      setEditingReview(null); setIsKeyboardActive(false);
      showToast("리뷰가 수정되었습니다.");
      await updateAISummaryIfNeeded(updatedReviews);
    } catch (e) { showToast("리뷰 수정 실패", "error"); }
  };

  const handleDeleteReview = async (rev) => {
    if (!window.confirm("정말 이 리뷰를 삭제하시겠습니까?")) return;
    try {
      const updatedReviews = (judge.reviews || []).filter(r => r && (r.timestamp !== rev.timestamp || r.uid !== rev.uid));
      await updateDoc(doc(db, "judges", judge.id), { reviews: updatedReviews });
      showToast("리뷰가 삭제되었습니다.");
      await updateAISummaryIfNeeded(updatedReviews);
    } catch (e) { showToast("리뷰 삭제 실패", "error"); }
  };

  const handleLikeReview = async (rev) => {
    if (!user) return showToast("로그인이 필요합니다.", "error");
    const likedUsers = rev.likedUsers || [];
    const isReviewLiked = likedUsers.includes(user.uid);
    try {
      const updatedReviews = (judge.reviews || []).map(r => {
        if (!r) return r;
        if (r.uid === rev.uid && r.timestamp === rev.timestamp) {
          if (isReviewLiked) return { ...r, likes: Math.max(0, (r.likes || 1) - 1), likedUsers: likedUsers.filter(id => id !== user.uid) };
          else return { ...r, likes: (r.likes || 0) + 1, likedUsers: [...likedUsers, user.uid] };
        }
        return r;
      });
      await updateDoc(doc(db, "judges", judge.id), { reviews: updatedReviews });
    } catch (e) { showToast("오류가 발생했습니다.", "error"); }
  };

  const submitReply = async (targetRev) => {
    if (!replyText.trim()) return showToast("답글 내용을 입력해주세요.", "error");
    try {
      const newReply = { uid: user.uid, userName: user.displayName || "익명", text: replyText, timestamp: new Date().toISOString() };
      const updatedReviews = (judge.reviews || []).map(r => {
        if (!r) return r;
        if (r.timestamp === targetRev.timestamp && r.uid === targetRev.uid) {
          return { ...r, replies: [...(r.replies || []), newReply] };
        }
        return r;
      });
      await updateDoc(doc(db, "judges", judge.id), { reviews: updatedReviews });
      setReplyingTo(null); setReplyText(""); setIsKeyboardActive(false);
      showToast("답글이 등록되었습니다.");
    } catch (e) { showToast("답글 등록 실패", "error"); }
  };

  const handleDeleteReply = async (rev, replyToDel) => {
    if (!window.confirm("정말 이 답글을 삭제하시겠습니까?")) return;
    try {
      const updatedReviews = (judge.reviews || []).map(r => {
        if (!r) return r;
        if (r.timestamp === rev.timestamp && r.uid === rev.uid) {
          return { ...r, replies: (r.replies || []).filter(reply => reply && reply.timestamp !== replyToDel.timestamp) };
        }
        return r;
      });
      await updateDoc(doc(db, "judges", judge.id), { reviews: updatedReviews });
      showToast("답글이 삭제되었습니다.");
    } catch (e) { showToast("답글 삭제 실패", "error"); }
  };

  const submitEditReply = async (rev, replyToEdit) => {
    if (!editingReply?.text?.trim()) return showToast("내용을 입력해주세요.", "error");
    try {
      const updatedReviews = (judge.reviews || []).map(r => {
        if (!r) return r;
        if (r.timestamp === rev.timestamp && r.uid === rev.uid) {
          const updatedReplies = (r.replies || []).map(reply => {
            if (!reply) return reply;
            if (reply.timestamp === replyToEdit.timestamp) return { ...reply, text: editingReply.text, isEdited: true };
            return reply;
          });
          return { ...r, replies: updatedReplies };
        }
        return r;
      });
      await updateDoc(doc(db, "judges", judge.id), { reviews: updatedReviews });
      setEditingReply(null); setIsKeyboardActive(false);
      showToast("답글이 수정되었습니다.");
    } catch (e) { showToast("답글 수정 실패", "error"); }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300">
        <div className={`w-full max-w-md bg-white rounded-t-3xl shadow-2xl flex flex-col transition-all duration-300 ease-in-out ${isKeyboardActive ? 'h-[100dvh] rounded-none' : 'h-[90dvh]'}`}>
          
          <div className="p-4 pb-3 border-b border-slate-100 shrink-0 flex justify-between items-center bg-white rounded-t-3xl">
            {currentTab === 'map' && selectedRegionName ? (
              <button onClick={onClose} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 font-bold text-sm bg-slate-50 px-2 py-1.5 rounded-lg transition-colors"><ChevronLeft size={18} /> 목록</button>
            ) : (<h2 className="text-base font-bold text-slate-900 ml-1">상세 정보</h2>)}
            <div className="flex items-center gap-2">
              <button onClick={toggleBookmark} className={`p-1.5 rounded-full transition-colors ${isBookmarked ? 'bg-pink-50 text-pink-500' : 'bg-slate-50 hover:bg-pink-50 hover:text-pink-500 text-slate-500'}`}>
                <Heart size={18} className={isBookmarked ? 'fill-pink-500' : ''} />
              </button>
              <button onClick={handleShare} className="p-1.5 bg-slate-50 hover:bg-blue-50 hover:text-blue-600 rounded-full text-slate-500 transition-colors"><Share2 size={18} /></button>
              <button onClick={onClose} className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"><X size={20} /></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 custom-scrollbar pb-4 animate-fade-in">
            <div className="bg-slate-50 p-4 rounded-xl mt-3 mb-4 border border-slate-100 relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-[11px] font-semibold text-slate-500 mb-1">{judge?.region} • {judge?.department}</p>
                <p className="text-xl font-extrabold text-slate-800">{judge?.name} <span className="text-xs font-medium text-slate-600">{judge?.title}</span></p>
                <p className="text-xs text-slate-600 mt-2">💼 {judge?.career || '경력 정보 없음'}</p>
              </div>
            </div>

            {judge?.ai_summary && (
              <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl mb-4">
                <p className="text-[12px] font-bold text-indigo-800 flex items-center gap-1 mb-2"><Bot size={14}/> 리뷰 기반 AI 요약</p>
                <p className="text-[13px] text-indigo-900 leading-relaxed whitespace-pre-wrap">{judge.ai_summary}</p>
              </div>
            )}

            <h3 className="text-[13px] font-bold text-slate-700 mb-2 px-1 mt-6">판결 성향 통계</h3>
            <div className="h-40 w-full mb-1 relative flex items-center justify-center">
              <div ref={chartRef} style={{ width: '100%', height: '100%' }}></div>
              <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                 <span className="text-[10px] text-slate-400 font-bold">총 건수</span>
                 <span className="text-sm font-extrabold text-slate-700">100%</span>
              </div>
            </div>

            <div className="grid grid-cols-3 text-center text-[10px] font-bold mb-6 gap-2 border-b border-slate-100 pb-4 mt-2">
              <div className="bg-blue-50 text-blue-700 p-2 rounded-xl">원고 승소<br/><span className="text-sm">{judge?.win_rate || 0}%</span></div>
              <div className="bg-red-50 text-red-700 p-2 rounded-xl">피고 승소<br/><span className="text-sm">{judge?.lose_rate || 0}%</span></div>
              <div className="bg-emerald-50 text-emerald-700 p-2 rounded-xl">조정/화해<br/><span className="text-sm">{judge?.draw_rate || 0}%</span></div>
            </div>

            <div className="mb-2">
              <h3 className="text-[13px] font-bold text-slate-700 mb-3 px-1 flex justify-between items-center">
                시민 평가 내역 <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{(judge.reviews || []).filter(Boolean).length}건</span>
              </h3>
              {(!judge.reviews || judge.reviews.length === 0) ? (
                <p className="text-center text-xs text-slate-400 py-4 bg-slate-50 rounded-xl border border-slate-100">등록된 리뷰가 없습니다.</p>
              ) : (
                <div className="space-y-4">
                  {[...judge.reviews].filter(Boolean).reverse().map((rev, idx) => {
                    const authorBadge = getUserBadge(allJudges.reduce((acc, j) => acc + (j.reviews?.filter(r => r?.uid === rev.uid).length || 0), 0)) || { icon: '', text: '시민', color: 'bg-slate-100 text-slate-500' };
                    const isReviewLiked = rev.likedUsers?.includes(user?.uid);
                    const isMyReview = user?.uid === rev.uid;
                    const isEditing = editingReview?.timestamp === rev.timestamp;
                    const isReplying = replyingTo === rev.timestamp;

                    return (
                      <div key={idx} className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                        <div className="flex justify-between items-center mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center">{[1,2,3,4,5].map(star => (<Star key={star} size={10} className={star <= (rev.rating || 5) ? "fill-amber-400 text-amber-400" : "text-slate-200"} />))}</div>
                            <span className="text-[10px] font-bold text-slate-700">{rev.userName?.split(' ')[0] || "익명"}</span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-sm ${authorBadge.color}`}>{authorBadge.icon} {authorBadge.text}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-slate-400 font-medium">{formatDate(rev.timestamp)} {rev.isEdited && '(수정됨)'}</span>
                            {isMyReview && !isEditing && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => setEditingReview({ timestamp: rev.timestamp, text: rev.comment || '' })} className="text-slate-400 hover:text-blue-500"><Edit2 size={12} /></button>
                                <button onClick={() => handleDeleteReview(rev)} className="text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                              </div>
                            )}
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="mt-2 mb-2 relative">
                            <textarea 
                              className="w-full p-2.5 pr-10 border border-blue-300 rounded-lg text-[12px] bg-blue-50/30 outline-none resize-none" 
                              rows="2" value={editingReview?.text || ''} 
                              onChange={(e) => setEditingReview({ ...editingReview, text: e.target.value })}
                              onFocus={() => setIsKeyboardActive(true)} onBlur={() => setIsKeyboardActive(false)}
                            />
                            <div className="flex justify-end gap-2 mt-1">
                              <button onClick={() => setEditingReview(null)} className="text-[10px] text-slate-500 px-2 py-1 bg-slate-100 rounded-md font-bold">취소</button>
                              <button onClick={() => submitEditReview(rev)} className="text-[10px] text-white px-2 py-1 bg-blue-600 rounded-md font-bold">수정 완료</button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[13px] text-slate-700 mb-3 leading-snug">{rev.comment}</p>
                        )}
                        
                        <div className="flex gap-3 justify-end border-t border-slate-50 pt-2 mt-1">
                          <button onClick={() => handleLikeReview(rev)} className={`flex items-center gap-1 text-[10px] font-bold transition-colors ${isReviewLiked ? 'text-blue-600' : 'text-slate-400 hover:text-blue-500'}`}>
                            <ThumbsUp size={12} className={isReviewLiked ? 'fill-blue-600' : ''} /> 공감 {rev.likes > 0 ? rev.likes : ''}
                          </button>
                          <button onClick={() => { if(!user) return showToast("로그인이 필요합니다.", "error"); setReplyingTo(isReplying ? null : rev.timestamp); }} className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-indigo-500 transition-colors">
                            <MessageSquare size={12} /> 답글
                          </button>
                          {!isMyReview && (
                            <button onClick={() => { if(!user) return showToast("로그인이 필요합니다.", "error"); setReportModalReview(rev); }} className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors">
                              <Flag size={12} /> 신고
                            </button>
                          )}
                        </div>

                        {isReplying && (
                          <div className="mt-3 pl-2 border-l-2 border-indigo-200 relative flex items-start gap-2">
                            <CornerDownRight size={14} className="text-indigo-300 mt-1.5 shrink-0" />
                            <textarea 
                              className="flex-1 p-2 border border-slate-200 rounded-lg text-[11px] bg-slate-50 outline-none resize-none"
                              rows="1" placeholder="답글을 남겨주세요." value={replyText} 
                              onChange={(e) => setReplyText(e.target.value)}
                              onFocus={() => setIsKeyboardActive(true)} onBlur={() => setIsKeyboardActive(false)}
                            />
                            <button onClick={() => submitReply(rev)} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shrink-0"><Send size={12}/></button>
                          </div>
                        )}

                        {rev.replies && rev.replies.length > 0 && (
                          <div className="mt-3 pl-2 border-l-2 border-slate-200 space-y-2">
                            {rev.replies.filter(Boolean).map((reply, rIdx) => {
                              const isMyReply = user?.uid === reply?.uid;
                              const isEditingReply = editingReply?.reviewTimestamp === rev.timestamp && editingReply?.replyTimestamp === reply?.timestamp;

                              return (
                                <div key={rIdx} className="bg-slate-50 p-2 rounded-lg ml-2 relative">
                                  <div className="flex justify-between items-center mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-bold text-slate-700">{reply?.userName || "익명"}</span>
                                      <span className="text-[8px] text-slate-400">{formatDate(reply?.timestamp)} {reply?.isEdited && '(수정됨)'}</span>
                                    </div>
                                    {isMyReply && !isEditingReply && (
                                      <div className="flex items-center gap-1.5">
                                        <button onClick={() => setEditingReply({ reviewTimestamp: rev.timestamp, replyTimestamp: reply.timestamp, text: reply.text })} className="text-slate-400 hover:text-indigo-500"><Edit2 size={10} /></button>
                                        <button onClick={() => handleDeleteReply(rev, reply)} className="text-slate-400 hover:text-red-500"><Trash2 size={10} /></button>
                                      </div>
                                    )}
                                  </div>
                                  
                                  {isEditingReply ? (
                                    <div className="mt-1 relative">
                                      <textarea 
                                        className="w-full p-2 border border-indigo-300 rounded-md text-[11px] bg-indigo-50/30 outline-none resize-none" 
                                        rows="1" value={editingReply?.text || ''} 
                                        onChange={(e) => setEditingReply({ ...editingReply, text: e.target.value })}
                                        onFocus={() => setIsKeyboardActive(true)} onBlur={() => setIsKeyboardActive(false)}
                                      />
                                      <div className="flex justify-end gap-1 mt-1">
                                        <button onClick={() => setEditingReply(null)} className="text-[9px] text-slate-500 px-1.5 py-0.5 bg-slate-200 rounded font-bold">취소</button>
                                        <button onClick={() => submitEditReply(rev, reply)} className="text-[9px] text-white px-1.5 py-0.5 bg-indigo-600 rounded font-bold">수정</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-slate-600 leading-snug">{reply?.text}</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className={`p-4 pt-3 bg-white border-t border-slate-100 shrink-0 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] transition-all duration-300 ${isKeyboardActive ? 'pb-[35vh]' : 'pb-4'}`}>
            {!user ? (
              <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-[13px] font-bold text-slate-600 mb-2">리뷰를 작성하려면 로그인이 필요합니다.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 mb-2 px-1">
                  <span className="text-[11px] font-bold text-slate-500 mr-2">별점:</span>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} onClick={() => setRating(star)} className="p-0.5 transition-transform hover:scale-110 active:scale-95">
                      <Star size={18} className={star <= rating ? "fill-amber-400 text-amber-400 drop-shadow-sm" : "text-slate-200 fill-slate-50"} />
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <textarea
                    className="w-full p-3 pr-12 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none text-[13px] bg-slate-50 transition-all"
                    rows="2" placeholder="이 판사에 대한 경험을 나누어주세요." value={reviewText} onChange={(e) => setReviewText(e.target.value)}
                    onFocus={() => setIsKeyboardActive(true)} onBlur={() => setIsKeyboardActive(false)}
                  />
                  <button onClick={submitReview} className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all ${reviewText.trim() ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                    <MessageSquare size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      {reportModalReview && <ReportModal review={reportModalReview} judgeId={judge.id} user={user} onClose={() => setReportModalReview(null)} showToast={showToast} />}
    </>
  );
}