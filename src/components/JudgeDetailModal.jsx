import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts'; // 💡 recharts 대신 echarts를 사용합니다.
import { 
  ChevronLeft, Share2, X, Bot, Star, ThumbsUp, Flag, MessageSquare, Heart 
} from 'lucide-react';
import { db } from '../firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { formatDate, getUserBadge } from '../utils';
import ReportModal from './ReportModal';

export default function JudgeDetailModal({ judge, allJudges, user, onClose, showToast, currentTab, selectedRegionName }) {
  const chartRef = useRef(null); // ECharts 연결을 위한 Ref
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(5);
  const [isKeyboardActive, setIsKeyboardActive] = useState(false);
  const [reportModalReview, setReportModalReview] = useState(null);

  // 차트 데이터 정리
  const chartData = [
    { name: '원고 승소', value: judge.win_rate || 33, itemStyle: { color: '#3B82F6' } },
    { name: '피고 승소', value: judge.lose_rate || 33, itemStyle: { color: '#EF4444' } },
    { name: '조정/화해', value: judge.draw_rate || 34, itemStyle: { color: '#10B981' } }
  ];

  // 즐겨찾기 상태
  const bookmarkedUsers = judge.bookmarkedUsers || [];
  const isBookmarked = bookmarkedUsers.includes(user?.uid);

  // 💡 ECharts 차트 렌더링 로직
  useEffect(() => {
    let myChart = null;
    if (chartRef.current) {
      myChart = echarts.init(chartRef.current);
      myChart.setOption({
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          borderColor: '#e2e8f0',
          textStyle: { fontSize: 11, fontWeight: 'bold' }
        },
        series: [
          {
            type: 'pie',
            radius: ['45%', '70%'], // 도넛 형태
            avoidLabelOverlap: true,
            itemStyle: {
              borderRadius: 5,
              borderColor: '#fff',
              borderWidth: 2
            },
            label: {
              show: true,
              formatter: '{d}%', // 👈 모바일에서 보기 좋게 % 숫자만 표시
              fontWeight: 'bold',
              fontSize: 12,
              color: '#475569'
            },
            labelLine: {
              show: true,
              length: 5, // 라인 길이 줄임
              length2: 5
            },
            data: chartData
          }
        ]
      });
    }

    const handleResize = () => {
      if (myChart) myChart.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (myChart) myChart.dispose();
    };
  }, [judge]); // judge 데이터가 바뀔 때마다 차트 업데이트

  // 즐겨찾기 토글
  const toggleBookmark = async () => {
    if (!user) return showToast("즐겨찾기를 하려면 먼저 로그인해주세요.", "error");
    try {
      const newBookmarks = isBookmarked
        ? bookmarkedUsers.filter(id => id !== user.uid)
        : [...bookmarkedUsers, user.uid];
      
      await updateDoc(doc(db, "judges", judge.id), { bookmarkedUsers: newBookmarks });
      showToast(isBookmarked ? "즐겨찾기에서 해제되었습니다." : "즐겨찾기에 추가되었습니다!");
    } catch (e) {
      showToast("즐겨찾기 처리 실패", "error");
    }
  };

  // 공유하기
  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?judgeId=${judge.id}`;
    const shareData = { 
      title: `${judge.name} 판사 정보 - JUDGE MAP`, 
      text: `${judge.court} 소속 ${judge.name} 판사의 판결 성향과 리뷰를 확인해보세요!`, 
      url: shareUrl 
    };

    if (navigator.share) { 
      try { await navigator.share(shareData); } catch (e) {} 
    } else { 
      navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`); 
      showToast("클립보드에 판사 전용 링크가 복사되었습니다!"); 
    }
  };

  // 리뷰 등록 및 AI 요약
  const submitReview = async () => {
    if (!user) return showToast("리뷰를 작성하려면 먼저 로그인해주세요.", "error");
    if (!reviewText.trim()) return showToast("리뷰 내용을 입력해주세요.", "error");
    try {
      const updatedReviews = [...(judge.reviews || []), { rating, comment: reviewText, timestamp: new Date().toISOString(), userName: user.displayName || "익명", uid: user.uid, likes: 0, likedUsers: [] }];
      await updateDoc(doc(db, "judges", judge.id), { reviews: arrayUnion(updatedReviews[updatedReviews.length-1]) });
      setReviewText(""); setIsKeyboardActive(false); showToast("소중한 리뷰가 등록되었습니다.");
      
      if (updatedReviews.length >= 2) {
        const ACTUAL_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY; 
        if (!ACTUAL_GEMINI_API_KEY) return;
        const prompt = `다음은 ${judge.name} 판사에 대한 리뷰입니다. 이 리뷰들의 공통적인 내용과 판사의 재판 성향을 3줄로 객관적으로 요약해주세요:\n\n${updatedReviews.map(r => r.comment).join("\n")}`;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${ACTUAL_GEMINI_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const data = await res.json();
        if (res.ok && data.candidates?.length > 0) await updateDoc(doc(db, "judges", judge.id), { ai_summary: data.candidates[0].content.parts[0].text });
      }
    } catch (e) { showToast("리뷰 등록 실패", "error"); }
  };

  // 리뷰 좋아요
  const handleLikeReview = async (rev) => {
    if (!user) return showToast("로그인이 필요합니다.", "error");
    const likedUsers = rev.likedUsers || [];
    const isReviewLiked = likedUsers.includes(user.uid);
    try {
      const updatedReviews = judge.reviews.map(r => {
        if (r.uid === rev.uid && r.timestamp === rev.timestamp) {
          if (isReviewLiked) return { ...r, likes: Math.max(0, (r.likes || 1) - 1), likedUsers: likedUsers.filter(id => id !== user.uid) };
          else return { ...r, likes: (r.likes || 0) + 1, likedUsers: [...likedUsers, user.uid] };
        }
        return r;
      });
      await updateDoc(doc(db, "judges", judge.id), { reviews: updatedReviews });
    } catch (e) { showToast("오류가 발생했습니다.", "error"); }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300">
        <div className={`w-full max-w-md bg-white rounded-t-3xl shadow-2xl flex flex-col transition-all duration-300 ease-in-out ${isKeyboardActive ? 'h-[100dvh] rounded-none' : 'h-[90dvh]'}`}>
          
          {/* Header */}
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

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto px-5 custom-scrollbar pb-4 animate-fade-in">
            {/* 판사 기본 정보 */}
            <div className="bg-slate-50 p-4 rounded-xl mt-3 mb-4 border border-slate-100 relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-[11px] font-semibold text-slate-500 mb-1">{judge.region} • {judge.department}</p>
                <p className="text-xl font-extrabold text-slate-800">{judge.name} <span className="text-xs font-medium text-slate-600">{judge.title}</span></p>
                <p className="text-xs text-slate-600 mt-2">💼 {judge.career || '경력 정보 없음'}</p>
              </div>
            </div>

            {/* AI 요약 */}
            {judge.ai_summary && (
              <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl mb-4">
                <p className="text-[12px] font-bold text-indigo-800 flex items-center gap-1 mb-2"><Bot size={14}/> 리뷰 기반 AI 요약</p>
                <p className="text-[13px] text-indigo-900 leading-relaxed whitespace-pre-wrap">{judge.ai_summary}</p>
              </div>
            )}

            {/* 💡 업그레이드된 ECharts 파이 차트 영역 */}
            <h3 className="text-[13px] font-bold text-slate-700 mb-2 px-1 mt-6">판결 성향 통계</h3>
            <div className="h-40 w-full mb-1 relative flex items-center justify-center">
              {/* ECharts 컨테이너 */}
              <div ref={chartRef} style={{ width: '100%', height: '100%' }}></div>
              {/* 도넛 차트 가운데 들어갈 텍스트 */}
              <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                 <span className="text-[10px] text-slate-400 font-bold">총 건수</span>
                 <span className="text-sm font-extrabold text-slate-700">100%</span>
              </div>
            </div>

            <div className="grid grid-cols-3 text-center text-[10px] font-bold mb-6 gap-2 border-b border-slate-100 pb-4 mt-2">
              <div className="bg-blue-50 text-blue-700 p-2 rounded-xl">원고 승소<br/><span className="text-sm">{judge.win_rate || 0}%</span></div>
              <div className="bg-red-50 text-red-700 p-2 rounded-xl">피고 승소<br/><span className="text-sm">{judge.lose_rate || 0}%</span></div>
              <div className="bg-emerald-50 text-emerald-700 p-2 rounded-xl">조정/화해<br/><span className="text-sm">{judge.draw_rate || 0}%</span></div>
            </div>

            {/* 리뷰 리스트 */}
            <div className="mb-2">
              <h3 className="text-[13px] font-bold text-slate-700 mb-3 px-1 flex justify-between items-center">
                시민 평가 내역 <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{judge.reviews?.length || 0}건</span>
              </h3>
              {(!judge.reviews || judge.reviews.length === 0) ? (
                <p className="text-center text-xs text-slate-400 py-4 bg-slate-50 rounded-xl border border-slate-100">등록된 리뷰가 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {[...judge.reviews].reverse().map((rev, idx) => {
                    const authorBadge = getUserBadge(allJudges.reduce((acc, j) => acc + (j.reviews?.filter(r => r.uid === rev.uid).length || 0), 0));
                    const isReviewLiked = rev.likedUsers?.includes(user?.uid);
                    return (
                      <div key={idx} className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                        <div className="flex justify-between items-center mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center">{[1,2,3,4,5].map(star => (<Star key={star} size={10} className={star <= rev.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"} />))}</div>
                            <span className="text-[10px] font-bold text-slate-700">{rev.userName?.split(' ')[0] || "익명"}</span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-sm ${authorBadge.color}`}>{authorBadge.icon} {authorBadge.text}</span>
                          </div>
                          <span className="text-[9px] text-slate-400 font-medium">{formatDate(rev.timestamp)}</span>
                        </div>
                        <p className="text-[13px] text-slate-700 mb-3 leading-snug">{rev.comment}</p>
                        
                        <div className="flex gap-3 justify-end border-t border-slate-50 pt-2 mt-1">
                          <button onClick={() => handleLikeReview(rev)} className={`flex items-center gap-1 text-[10px] font-bold transition-colors ${isReviewLiked ? 'text-blue-600' : 'text-slate-400 hover:text-blue-500'}`}>
                            <ThumbsUp size={12} className={isReviewLiked ? 'fill-blue-600' : ''} /> 공감 {rev.likes > 0 ? rev.likes : ''}
                          </button>
                          <button onClick={() => { if(!user) return showToast("로그인이 필요합니다.", "error"); setReportModalReview(rev); }} className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors">
                            <Flag size={12} /> 신고
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 리뷰 작성 입력창 (키보드 대응) */}
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