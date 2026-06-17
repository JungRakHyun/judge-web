import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as echarts from 'echarts';
import { 
  Scale, LogIn, Map as MapIcon, Search, PlusCircle, UserCircle, Star, ChevronRight, 
  ShieldAlert, Settings, Edit, Trash2, CheckCircle2, AlertCircle, MapPin, X 
} from 'lucide-react';
import { db, auth, googleProvider } from './firebase'; 
import { collection, onSnapshot, doc, addDoc, query, where, deleteDoc } from 'firebase/firestore';
// 💡 리디렉션으로 복구 (팝업은 브라우저가 강제 차단하므로 폐기)
import { signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from 'firebase/auth';

import { regionMapping, getAvgRating, formatDate, getUserBadge } from './utils';
import JudgeDetailModal from './components/JudgeDetailModal';
import AdminEditModal from './components/AdminEditModal';

const JudgeSkeletonCard = () => (
  <div className="bg-white border border-slate-200 p-4 rounded-2xl flex justify-between items-center shadow-sm animate-pulse">
    <div className="space-y-3">
      <div className="h-3 bg-slate-200 rounded w-24"></div>
      <div className="h-5 bg-slate-200 rounded w-32"></div>
    </div>
    <div className="flex items-center gap-3">
      <div className="space-y-2 text-right">
        <div className="h-4 bg-slate-200 rounded w-10 ml-auto"></div>
        <div className="h-3 bg-slate-200 rounded w-14 ml-auto"></div>
      </div>
      <div className="w-8 h-8 bg-slate-100 rounded-full"></div>
    </div>
  </div>
);

export default function JudgeMapApp() {
  const mapRef = useRef(null);
  
  const [showSplash, setShowSplash] = useState(true);
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true); 
  const [currentTab, setCurrentTab] = useState('map'); 
  const [judges, setJudges] = useState([]); 
  const [reports, setReports] = useState([]); 
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  const [selectedRegionName, setSelectedRegionName] = useState(null); 
  const [selectedJudge, setSelectedJudge] = useState(null); 
  
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("latest"); 
  const [mapStatus, setMapStatus] = useState("loading");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [editModalJudge, setEditModalJudge] = useState(null);

  const [displayCount, setDisplayCount] = useState(10);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const observer = useRef();

  const [newJudge, setNewJudge] = useState({
    name: '', title: '판사', region: '서울', court: '', department: '', career: '', ai_summary: '',
    win_rate: 45, lose_rate: 35, draw_rate: 20
  });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 2500);
  };

  const isAdmin = user?.email === 'jlh9809@gmail.com';

  useEffect(() => { setTimeout(() => setShowSplash(false), 1500); }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.visualViewport) {
        const diff = window.innerHeight - window.visualViewport.height;
        setKeyboardOffset(diff > 50 ? diff * 0.8 : 0);
      }
    };
    window.visualViewport?.addEventListener('resize', handleResize);
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }, []);

  // 💡 [핵심 해결] sessionStorage를 활용한 완벽한 로그인 타이밍 제어
  useEffect(() => {
    let isMounted = true;
    // 우리가 구글 로그인 창으로 보냈던 것인지 기록을 확인합니다.
    const isRedirecting = sessionStorage.getItem('isRedirecting') === 'true';

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!isMounted) return;
      setUser(currentUser);
      
      if (currentUser) {
        // 1. 정상적으로 유저 정보가 들어온 경우
        sessionStorage.removeItem('isRedirecting');
        setIsAuthLoading(false);
      } else {
        // 2. 유저 정보가 없을 때
        if (isRedirecting) {
          // 구글에서 막 돌아왔다면 파이어베이스가 티켓을 발급할 때까지 기다려줍니다.
          getRedirectResult(auth)
            .then((result) => {
              if (result?.user) showToast("로그인 성공!");
            })
            .catch((error) => console.error("로그인 에러:", error))
            .finally(() => {
              if (isMounted) {
                sessionStorage.removeItem('isRedirecting');
                setIsAuthLoading(false); // 처리가 다 끝나면 비로소 로딩 해제
              }
            });
        } else {
          // 구글 로그인 기록이 없으면 일반 비로그인 유저이므로 바로 화면 표시
          setIsAuthLoading(false);
        }
      }
    });

    // 만약 통신이 끊겨서 영원히 로딩되는 것을 막기 위한 5초 안전 타이머
    const timer = setTimeout(() => {
      if (isMounted) {
        sessionStorage.removeItem('isRedirecting');
        setIsAuthLoading(false);
      }
    }, 5000);

    return () => {
      isMounted = false;
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    setDisplayCount(10);
  }, [searchQuery, sortOption, currentTab, selectedRegionName]);

  useEffect(() => {
    if (judges.length > 0) {
      const urlParams = new URLSearchParams(window.location.search);
      const targetJudgeId = urlParams.get('judgeId');
      
      if (targetJudgeId && !selectedJudge) {
        const targetJudge = judges.find(j => j.id === targetJudgeId);
        if (targetJudge) {
          setSelectedJudge(targetJudge); 
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    }
  }, [judges]);
  
  const lastElementRef = useCallback(node => {
    if (isLoadingData) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setDisplayCount(prev => prev + 10);
    });
    
    if (node) observer.current.observe(node);
  }, [isLoadingData]);

  useEffect(() => {
    if (isAuthLoading) return;

    const unsubJudges = onSnapshot(collection(db, "judges"), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setJudges(data);
      setIsLoadingData(false); 
      
      if (selectedJudge) {
        const updated = data.find(j => j.id === selectedJudge.id);
        if (updated) setSelectedJudge(updated);
      }
    });
    
    let unsubReports = () => {};
    if (user) {
      unsubReports = onSnapshot(query(collection(db, "reports"), where("userId", "==", user.uid)), (snapshot) => {
        setReports(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    }
    return () => { unsubJudges(); unsubReports(); };
  }, [selectedJudge?.id, user?.uid, isAuthLoading]);

  useEffect(() => {
    if (currentTab !== 'map' || showSplash) return;
    
    let myChart = null;
    const initMap = async () => {
      try {
        const response = await fetch('https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2013/json/skorea_provinces_geo_simple.json');
        const geoJson = await response.json();
        setMapStatus("success");

        setTimeout(() => {
          if (mapRef.current) {
            myChart = echarts.init(mapRef.current);
            echarts.registerMap('korea', geoJson);
            myChart.setOption({
              tooltip: { show: false },
              series: [{
                type: 'map', map: 'korea', roam: true, zoom: 1.45, center: [127.7, 36.3], selectedMode: 'single',
                label: { show: true, fontSize: 11, fontWeight: 'bold', color: '#94a3b8', formatter: (params) => regionMapping[params.name] || params.name },
                itemStyle: { areaColor: '#1e293b', borderColor: '#334155', borderWidth: 1.5 },
                emphasis: { label: { color: '#ffffff' }, itemStyle: { areaColor: '#3b82f6' } },
                select: { label: { color: '#ffffff', fontWeight: 'bold' }, itemStyle: { areaColor: '#2563eb' } }
              }]
            });
            myChart.on('click', function (params) {
              setSelectedRegionName(regionMapping[params.name] || params.name);
              setSelectedJudge(null);
            });
          }
        }, 100);
      } catch (error) { setMapStatus("error"); }
    };
    initMap();
    const handleResize = () => { if (myChart) myChart.resize(); };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); if (myChart) myChart.dispose(); };
  }, [currentTab, showSplash]);

  // 💡 버튼 누를 때 '구글 로그인 창으로 가는 중'이라고 브라우저에 기록을 남김
  const handleLogin = () => {
    sessionStorage.setItem('isRedirecting', 'true');
    setIsAuthLoading(true);
    signInWithRedirect(auth, googleProvider);
  };

  const handleLogout = async () => {
    if (window.confirm("로그아웃하시겠습니까?")) {
      await signOut(auth); showToast("로그아웃 되었습니다."); setCurrentTab('map');
    }
  };

  const handleRegisterJudge = async () => {
    if (!user) return showToast("데이터를 등록하려면 먼저 로그인해주세요.", "error");
    if (!newJudge.name || !newJudge.court) return showToast("이름과 소속 법원은 필수입니다.", "error");
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "judges"), {
        ...newJudge, win_rate: Number(newJudge.win_rate), lose_rate: Number(newJudge.lose_rate), draw_rate: Number(newJudge.draw_rate),
        reviews: [], authorId: user.uid
      });
      showToast(`${newJudge.name} 판사 데이터가 등록되었습니다!`);
      setNewJudge({ name: '', title: '판사', region: '서울', court: '', department: '', career: '', ai_summary: '', win_rate: 45, lose_rate: 35, draw_rate: 20 });
      setCurrentTab('map');
    } catch (error) { showToast(`등록 실패`, "error"); } finally { setIsSubmitting(false); }
  };

  const handleDeleteJudge = async (judgeId, judgeName) => {
    if (window.confirm(`정말 ${judgeName} 판사 데이터를 영구 삭제하시겠습니까?`)) {
      try { await deleteDoc(doc(db, "judges", judgeId)); showToast("데이터가 삭제되었습니다."); } 
      catch (error) { showToast("삭제 중 오류가 발생했습니다.", "error"); }
    }
  };

  const regionJudges = selectedRegionName ? judges.filter(j => j.region === selectedRegionName) : [];
  let searchedJudges = judges.filter(j => j.name.includes(searchQuery) || j.court.includes(searchQuery) || j.region.includes(searchQuery));
  searchedJudges.sort((a, b) => {
    if (sortOption === 'rating') return parseFloat(getAvgRating(b.reviews)) - parseFloat(getAvgRating(a.reviews));
    if (sortOption === 'reviews') return (b.reviews?.length || 0) - (a.reviews?.length || 0);
    return 0; 
  });

  const myReviews = [];
  judges.forEach(j => { j.reviews?.forEach(r => { if (r.uid === user?.uid) myReviews.push({ judgeId: j.id, judgeName: j.name, court: j.court, ...r }); }); });
  myReviews.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const myBadge = getUserBadge(myReviews.length);

  if (showSplash || isAuthLoading) {
    return (
      <div className="w-full h-[100dvh] bg-[#0B1120] flex flex-col items-center justify-center select-none animate-fade-in">
        <Scale className="text-blue-500 mb-5 animate-pulse" size={64} />
        <h1 className="text-white font-extrabold text-3xl tracking-tight leading-tight mb-2">JUDGE MAP</h1>
        <p className="text-slate-400 text-xs font-bold tracking-widest">법관 통합 정보 생태계</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[100dvh] bg-[#0B1120] flex flex-col items-center overflow-hidden select-none pb-[60px]">
      
      <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[9999] transition-all duration-300 pointer-events-none ${toast.show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
        <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl border ${toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-800 border-slate-700 text-white'}`}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} className="text-emerald-400" />}
          <span className="text-xs font-bold whitespace-nowrap">{toast.message}</span>
        </div>
      </div>

      <header className="w-full max-w-md bg-[#0F172A] border-b border-slate-800 p-4 flex justify-between items-center z-10 shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600/20 p-2 rounded-lg"><Scale className="text-blue-500" size={22} /></div>
          <div><h1 className="text-white font-extrabold text-lg tracking-tight leading-tight">JUDGE MAP</h1><p className="text-slate-400 text-[10px] mt-0.5">법관 통합 정보 생태계</p></div>
        </div>
        <div>
          {user ? (
            <button onClick={handleLogout} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full text-xs font-bold transition border border-slate-700 shadow-sm"><img src={user.photoURL} alt="profile" className="w-5 h-5 rounded-full" /> 로그아웃</button>
          ) : (
            <button onClick={handleLogin} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-full text-xs font-bold transition shadow-md"><LogIn size={14} /> 로그인</button>
          )}
        </div>
      </header>

      {/* ==================== 1. 지도 탭 ==================== */}
      {currentTab === 'map' && (
        <div className="w-full max-w-md flex-1 flex flex-col relative px-2">
          <div className="relative w-full flex-1 flex items-center justify-center min-h-[400px]">
            {mapStatus === "loading" && <p className="text-blue-400 text-sm font-bold animate-pulse absolute z-0">지도를 불러오는 중...</p>}
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} className={`w-full z-0 transition-opacity duration-500 ${mapStatus === 'success' ? 'opacity-100' : 'opacity-0'}`}></div>
          </div>
          <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-slate-800/80 backdrop-blur border border-slate-700 text-slate-300 px-4 py-1.5 rounded-full text-[11px] font-bold pointer-events-none shadow-lg whitespace-nowrap">지역을 터치하거나 줌인하세요</div>

          {selectedRegionName && !selectedJudge && (
            <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300">
              <div style={{ transform: `translateY(-${keyboardOffset}px)` }} className="w-full max-w-md bg-slate-50 rounded-t-3xl shadow-2xl flex flex-col h-[80dvh] transition-transform duration-300">
                <div className="p-4 pb-3 border-b border-slate-200 bg-white rounded-t-3xl shrink-0 flex justify-between items-center">
                  <h2 className="text-base font-bold flex items-center gap-2 text-slate-900 ml-1"><MapPin className="text-blue-600 inline" size={18} /> {selectedRegionName} 관할 법관 ({isLoadingData ? '-' : regionJudges.length})</h2>
                  <button onClick={() => setSelectedRegionName(null)} className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-500"><X size={20} /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
                  {isLoadingData ? (
                    <div className="flex flex-col gap-3">
                      {[1, 2, 3, 4].map(i => <JudgeSkeletonCard key={i} />)}
                    </div>
                  ) : regionJudges.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 bg-white rounded-2xl border border-slate-200">
                      <p className="text-sm font-bold text-slate-500 mb-3">등록된 데이터가 없습니다.</p>
                      <button onClick={() => { setSelectedRegionName(null); setCurrentTab('register'); }} className="text-xs bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-700">신규 등록하기</button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {regionJudges.slice(0, displayCount).map(j => (
                        <div key={j.id} onClick={() => setSelectedJudge(j)} className="bg-white border border-slate-200 p-4 rounded-2xl flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 shadow-sm group animate-fade-in">
                          <div><p className="text-[11px] font-bold text-slate-500 mb-1">{j.court} • {j.department}</p><p className="text-lg font-extrabold text-slate-800 group-hover:text-blue-700">{j.name} <span className="text-sm font-medium text-slate-600">{j.title}</span></p></div>
                          <div className="flex items-center gap-3">
                            <div className="text-right"><div className="flex items-center justify-end gap-1 text-amber-500 font-bold text-[13px]"><Star size={12} className="fill-amber-500" /> {getAvgRating(j.reviews)}</div><p className="text-[10px] text-slate-400 mt-0.5">리뷰 {j.reviews?.length || 0}건</p></div>
                            <div className="text-slate-300 bg-slate-50 p-1.5 rounded-full group-hover:bg-blue-100 group-hover:text-blue-600"><ChevronRight size={18} /></div>
                          </div>
                        </div>
                      ))}
                      {displayCount < regionJudges.length && (
                        <div ref={lastElementRef} className="py-4 flex justify-center w-full">
                          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== 2. 검색 탭 ==================== */}
      {currentTab === 'search' && (
        <div className="w-full max-w-md flex-1 flex flex-col bg-slate-50">
          <div className="p-4 bg-white border-b border-slate-200 shadow-sm shrink-0">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
              <input type="text" placeholder="판사 이름, 법원, 지역 검색" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSortOption('latest')} className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${sortOption === 'latest' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>🕒 기본/최신순</button>
              <button onClick={() => setSortOption('rating')} className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${sortOption === 'rating' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>⭐ 별점높은순</button>
              <button onClick={() => setSortOption('reviews')} className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${sortOption === 'reviews' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>💬 리뷰많은순</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
            {isLoadingData ? (
              <div className="flex flex-col gap-3 pb-6">
                {[1, 2, 3, 4, 5].map(i => <JudgeSkeletonCard key={i} />)}
              </div>
            ) : (
              <div className="flex flex-col gap-3 pb-6">
                {searchedJudges.length === 0 ? ( <p className="text-center text-xs text-slate-400 py-10">검색 결과가 없습니다.</p> ) : (
                  <>
                    {searchedJudges.slice(0, displayCount).map(j => (
                      <div key={j.id} onClick={() => setSelectedJudge(j)} className="bg-white border border-slate-200 p-4 rounded-2xl flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 shadow-sm group animate-fade-in">
                        <div><p className="text-[11px] font-bold text-slate-500 mb-1">{j.region} • {j.court} • {j.department}</p><p className="text-lg font-extrabold text-slate-800 group-hover:text-blue-700">{j.name} <span className="text-sm font-medium text-slate-600">{j.title}</span></p></div>
                        <div className="flex items-center gap-3">
                          <div className="text-right"><div className="flex items-center justify-end gap-1 text-amber-500 font-bold text-[13px]"><Star size={12} className="fill-amber-500" /> {getAvgRating(j.reviews)}</div><p className="text-[10px] text-slate-400 mt-0.5">리뷰 {j.reviews?.length || 0}건</p></div>
                          <ChevronRight size={18} className="text-slate-300" />
                        </div>
                      </div>
                    ))}
                    {displayCount < searchedJudges.length && (
                      <div ref={lastElementRef} className="py-4 flex justify-center w-full">
                        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 3. 등록 탭 ==================== */}
      {currentTab === 'register' && (
        <div className="w-full max-w-md flex-1 overflow-y-auto px-4 py-4 custom-scrollbar bg-slate-50">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 pb-10">
            <h2 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2"><PlusCircle className="text-blue-600" /> 신규 데이터 등록</h2>
            {!user ? (
               <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl border border-slate-200 text-center"><LogIn className="text-slate-400 mb-3" size={28} /><p className="text-[15px] font-bold text-slate-700 mb-2">등록 권한이 없습니다.</p><button onClick={handleLogin} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold mt-2">구글로 로그인</button></div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[11px] font-bold text-slate-600 mb-1">이름</label><input type="text" className="w-full p-2.5 bg-slate-50 border rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-blue-500" value={newJudge.name} onChange={e=>setNewJudge({...newJudge, name: e.target.value})} placeholder="홍길동" /></div>
                  <div><label className="block text-[11px] font-bold text-slate-600 mb-1">직급</label><select className="w-full p-2.5 bg-slate-50 border rounded-xl text-[13px] outline-none" value={newJudge.title} onChange={e=>setNewJudge({...newJudge, title: e.target.value})}><option>판사</option><option>부장판사</option><option>수석부장판사</option><option>법원장</option></select></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">관할 지역</label>
                    <select className="w-full p-2.5 bg-slate-50 border rounded-xl text-[13px] outline-none" value={newJudge.region} onChange={e=>setNewJudge({...newJudge, region: e.target.value})}>
                      {Object.values(regionMapping).filter((v,i,a)=>a.indexOf(v)===i).map(r=><option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div><label className="block text-[11px] font-bold text-slate-600 mb-1">소속 법원</label><input type="text" className="w-full p-2.5 bg-slate-50 border rounded-xl text-[13px] outline-none" value={newJudge.court} onChange={e=>setNewJudge({...newJudge, court: e.target.value})} placeholder="서울중앙지법" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[11px] font-bold text-slate-600 mb-1">담당 부서</label><input type="text" className="w-full p-2.5 bg-slate-50 border rounded-xl text-[13px] outline-none" value={newJudge.department} onChange={e=>setNewJudge({...newJudge, department: e.target.value})} placeholder="형사1부" /></div>
                  <div><label className="block text-[11px] font-bold text-slate-600 mb-1">경력</label><input type="text" className="w-full p-2.5 bg-slate-50 border rounded-xl text-[13px] outline-none" value={newJudge.career} onChange={e=>setNewJudge({...newJudge, career: e.target.value})} placeholder="연수원 30기" /></div>
                </div>
                <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                  <label className="block text-[11px] font-bold text-blue-800 mb-2">판결 성향 (%)</label>
                  <div className="grid grid-cols-3 gap-2">
                    <div><label className="text-[10px] text-slate-500">원고 승</label><input type="number" className="w-full p-2 border rounded-lg text-xs" value={newJudge.win_rate} onChange={e=>setNewJudge({...newJudge, win_rate: e.target.value})} /></div>
                    <div><label className="text-[10px] text-slate-500">피고 승</label><input type="number" className="w-full p-2 border rounded-lg text-xs" value={newJudge.lose_rate} onChange={e=>setNewJudge({...newJudge, lose_rate: e.target.value})} /></div>
                    <div><label className="text-[10px] text-slate-500">조정/화해</label><input type="number" className="w-full p-2 border rounded-lg text-xs" value={newJudge.draw_rate} onChange={e=>setNewJudge({...newJudge, draw_rate: e.target.value})} /></div>
                  </div>
                </div>
                <button onClick={handleRegisterJudge} disabled={isSubmitting} className={`w-full text-white text-[13px] font-bold py-3.5 rounded-xl mt-4 transition-colors ${isSubmitting ? 'bg-slate-400' : 'bg-blue-600 hover:bg-blue-700'}`}>{isSubmitting ? '처리 중...' : '등록하기'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 4. 마이페이지 탭 ==================== */}
      {currentTab === 'mypage' && (
        <div className="w-full max-w-md flex-1 overflow-y-auto bg-slate-50 custom-scrollbar">
          {!user ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center"><UserCircle className="text-slate-300 mb-4" size={48} /><p className="text-lg font-bold text-slate-700 mb-2">로그인이 필요합니다</p><button onClick={handleLogin} className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md mt-4">구글로 로그인</button></div>
          ) : (
            <div>
              <div className="bg-white p-6 border-b border-slate-200 shadow-sm flex items-center gap-5">
                <img src={user.photoURL} alt="profile" className="w-16 h-16 rounded-full border border-slate-200 shadow-sm" />
                <div>
                  <div className="flex items-center gap-2 mb-1"><h2 className="text-xl font-extrabold text-slate-800">{user.displayName}</h2><span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${myBadge.color}`}>{myBadge.icon} {myBadge.text}</span></div>
                  <p className="text-[11px] text-slate-500 mb-2">{user.email}</p>
                  <div className="inline-block bg-slate-50 border border-slate-100 text-slate-600 px-2.5 py-1 rounded-md text-[10px] font-bold">작성한 리뷰 <span className="text-blue-600">{myReviews.length}</span>개</div>
                </div>
              </div>

              {isAdmin && (
                <div className="p-4 bg-indigo-50/50 border-b border-indigo-100">
                  <h3 className="text-sm font-bold text-indigo-900 mb-3 px-1 flex items-center gap-1"><Settings size={16}/> 관리자: 전체 판사 데이터 ({judges.length})</h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                    {judges.map(j => (
                      <div key={j.id} className="bg-white border border-indigo-100 p-3 rounded-xl shadow-sm flex justify-between items-center">
                        <div><p className="text-[11px] font-bold text-slate-500">{j.court}</p><p className="text-[13px] font-extrabold text-slate-800">{j.name} <span className="font-medium text-slate-500">{j.title}</span></p></div>
                        <div className="flex gap-2">
                          <button onClick={() => setEditModalJudge(j)} className="flex items-center gap-1 text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-1.5 rounded-lg hover:bg-indigo-100"><Edit size={12}/>수정</button>
                          <button onClick={() => handleDeleteJudge(j.id, j.name)} className="flex items-center gap-1 text-[10px] font-bold bg-red-50 text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-100"><Trash2 size={12}/>삭제</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4 pb-4">
                <h3 className="text-sm font-bold text-slate-800 mb-3 px-1">내가 작성한 리뷰</h3>
                {isLoadingData ? (
                  <div className="space-y-3">{[1, 2].map(i => <div key={i} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm animate-pulse h-24"></div>)}</div>
                ) : myReviews.length === 0 ? ( 
                  <p className="text-center text-xs text-slate-400 py-10 bg-white rounded-xl border border-slate-200">아직 작성한 리뷰가 없습니다.</p> 
                ) : (
                  <div className="space-y-3">
                    {myReviews.map((rev, idx) => (
                      <div key={idx} onClick={() => { const judge = judges.find(j => j.id === rev.judgeId); if(judge) setSelectedJudge(judge); }} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm cursor-pointer hover:border-blue-300">
                        <div className="flex justify-between items-center mb-2"><p className="text-xs font-bold text-blue-600">{rev.court} • {rev.judgeName}</p><span className="text-[10px] text-slate-400">{formatDate(rev.timestamp)}</span></div>
                        <div className="flex items-center mb-1.5 gap-1">{[1,2,3,4,5].map(star => (<Star key={star} size={10} className={star <= rev.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"} />))}</div>
                        <p className="text-[13px] text-slate-700">{rev.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 pb-20 border-t border-slate-200 border-dashed">
                <h3 className="text-sm font-bold text-slate-800 mb-3 px-1 flex items-center gap-1"><ShieldAlert size={16} className="text-red-500" /> 내 신고 내역</h3>
                {reports.length === 0 ? ( <p className="text-center text-xs text-slate-400 py-6 bg-white rounded-xl border border-slate-200">접수된 신고 내역이 없습니다.</p> ) : (
                  <div className="space-y-2">
                    {reports.map((rep, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                        <div className="flex justify-between items-center mb-1"><span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">{rep.category}</span><span className="text-[10px] font-bold text-slate-500">{rep.status}</span></div>
                        <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">사유: {rep.reason}</p><p className="text-[9px] text-slate-400 mt-2">{formatDate(rep.reportedAt)} 접수됨</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedJudge && <JudgeDetailModal judge={selectedJudge} keyboardOffset={keyboardOffset} allJudges={judges} user={user} onClose={() => setSelectedJudge(null)} showToast={showToast} currentTab={currentTab} selectedRegionName={selectedRegionName} />}
      {editModalJudge && <AdminEditModal judge={editModalJudge} keyboardOffset={keyboardOffset} onClose={() => setEditModalJudge(null)} showToast={showToast} />}

      <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-slate-200 flex justify-between items-center px-4 pb-[max(env(safe-area-inset-bottom),12px)] z-40 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.05)]">
        <button onClick={() => setCurrentTab('map')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'map' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><MapIcon size={20} className="mb-1" /><span className="text-[9px] font-bold">지도 검색</span></button>
        <button onClick={() => setCurrentTab('search')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'search' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><Search size={20} className="mb-1" /><span className="text-[9px] font-bold">통합 검색</span></button>
        <button onClick={() => setCurrentTab('register')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'register' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><PlusCircle size={20} className="mb-1" /><span className="text-[9px] font-bold">판사 등록</span></button>
        <button onClick={() => setCurrentTab('mypage')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'mypage' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><UserCircle size={20} className="mb-1" /><span className="text-[9px] font-bold">마이페이지</span></button>
      </nav>
    </div>
  );
}