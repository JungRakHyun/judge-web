import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as echarts from 'echarts';
import { 
  Scale, LogIn, Map as MapIcon, Search, PlusCircle, UserCircle, Star, ChevronRight, 
  ShieldAlert, Settings, Edit, Trash2, CheckCircle2, AlertCircle, MapPin, X 
} from 'lucide-react';
import { db, auth, googleProvider } from './firebase'; 
import { collection, onSnapshot, doc, addDoc, query, where, deleteDoc } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

import { regionMapping, getAvgRating, formatDate, getUserBadge } from './utils';
import JudgeDetailModal from './components/JudgeDetailModal';
import AdminEditModal from './components/AdminEditModal';

// [Component] 비동기 데이터 패칭 간 렌더링될 스켈레톤 UI
// 리스트 렌더링 지연 시 사용자 경험(UX) 저하를 방지하기 위한 Placeholder 컴포넌트
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
  
  // [State] 앱 세션 및 상태 유지 관리
  // 모바일 브라우저의 백그라운드 프로세스 정리로 인한 앱 초기화 현상을 방지하기 위해 Session Storage 사용
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splashShown'));
  const [currentTab, setCurrentTab] = useState(() => sessionStorage.getItem('currentTab') || 'map'); 
  
  // [Ref] popstate 이벤트 리스너 내에서 최신 상태(State)를 참조하기 위한 Mutable 객체
  const currentTabRef = useRef(currentTab);
  useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
  
  // [State] 글로벌 사용자 및 데이터 페이징 상태
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true); 
  const [judges, setJudges] = useState([]); 
  const [reports, setReports] = useState([]); 
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  const judgesRef = useRef(judges);
  useEffect(() => { judgesRef.current = judges; }, [judges]);

  // [State] 계층형 뷰(모달) 렌더링 트리거 상태
  const [selectedRegionName, setSelectedRegionName] = useState(null); 
  const selectedRegionRef = useRef(selectedRegionName);
  useEffect(() => { selectedRegionRef.current = selectedRegionName; }, [selectedRegionName]);

  const [selectedJudge, setSelectedJudge] = useState(null); 
  
  // [State] 검색, 정렬 및 기타 UI 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("latest"); 
  const [mapStatus, setMapStatus] = useState("loading");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [editModalJudge, setEditModalJudge] = useState(null);

  // [State] 인피니트 스크롤 최적화 상태
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

  // =====================================================================
  // [Routing] History API 기반 SPA 라우팅 및 기기 뒤로가기 버튼 컨트롤러
  // 브라우저의 History 스택을 명시적으로 관리하여 뷰 계층(Tab -> Region List -> Judge Detail) 간의 동기화를 보장
  // =====================================================================
  const lastBackPressRef = useRef(0);

  useEffect(() => {
    // 1. 초기 렌더링 시 스택 초기화
    // 빈 상태로 뒤로가기 클릭 시 즉각 종료되는 현상을 막기 위한 베이스 캠프(exit_trap) 스택 푸시
    if (!window.history.state || !window.history.state.type) {
      window.history.replaceState({ type: 'trap' }, '');
      window.history.pushState({ type: 'tab', tab: currentTab }, '');
    }

    const handlePopState = (e) => {
      const state = e.state;
      if (!state) return;

      if (state.type === 'trap') {
        // [Exit Logic] 히스토리 스택 최하단(Trap) 도달 시 앱 종료 시퀀스 실행
        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          // 2초 내 연속 이벤트 발생 시 실제 라우터 이탈 허용 (앱 종료)
          window.history.back(); 
        } else {
          lastBackPressRef.current = now;
          showToast("뒤로가기 버튼을 한 번 더 누르면 종료됩니다.");
          // 이탈을 임시 방어하기 위해 현재 상태 스택 재삽입
          window.history.pushState({ type: 'tab', tab: currentTabRef.current }, '');
        }
      } else {
        // [Sync Logic] 스택의 type 프로퍼티에 따른 View 동기화 처리
        // 뒤로가기 버튼을 눌러 스택이 팝업될 때마다 해당 스택의 데이터를 기반으로 UI 상태를 업데이트
        setCurrentTab(state.tab || 'map');
        setSelectedRegionName(state.region || null);
        
        if (state.judgeId && judgesRef.current.length > 0) {
          const target = judgesRef.current.find(j => j.id === state.judgeId);
          setSelectedJudge(target || null);
        } else {
          setSelectedJudge(null);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentTab]);

  // [Action] 탭 네비게이션 제어
  // 탭 이동 시에도 History 스택을 생성하여 타 탭에서 뒤로가기 시 앱이 종료되는 결함 방지
  const handleTabChange = (tabName) => {
    if (currentTab === tabName) return;
    setCurrentTab(tabName);
    setSelectedRegionName(null);
    setSelectedJudge(null);
    window.history.pushState({ type: 'tab', tab: tabName }, '');
  };

  // [Action] 판사 상세 모달 뷰 제어
  // 리스트나 검색 결과에서 판사 선택 시 History 스택 추가
  const handleJudgeClick = (judge) => {
    window.history.pushState({ 
      type: 'judge', 
      tab: currentTabRef.current, 
      region: selectedRegionRef.current, 
      judgeId: judge.id 
    }, '');
    setSelectedJudge(judge);
  };
  // =====================================================================

  // [Effect] 스플래시 스크린 타이머 (1.5초 유지 후 세션에 기록)
  useEffect(() => { 
    if (showSplash) {
      setTimeout(() => {
        setShowSplash(false);
        sessionStorage.setItem('splashShown', 'true');
      }, 1500); 
    }
  }, [showSplash]);

  // [Effect] 세션 스토리지 탭 상태 동기화 (새로고침 방어)
  useEffect(() => {
    sessionStorage.setItem('currentTab', currentTab);
  }, [currentTab]);

  // [Effect] 가상 키보드 호출에 따른 Viewport 리사이징 보정
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

  // [Effect] Firebase Authentication 구독 (Google OAuth 기반)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // [Effect] 검색 및 정렬 조건 변경 시 노출 아이템 초기화
  useEffect(() => {
    setDisplayCount(10);
  }, [searchQuery, sortOption, currentTab, selectedRegionName]);

  // [Effect] 외부 Query String 유입 시 특정 판사 상세 데이터 다이렉트 렌더링
  useEffect(() => {
    if (judges.length > 0) {
      const urlParams = new URLSearchParams(window.location.search);
      const targetJudgeId = urlParams.get('judgeId');
      
      if (targetJudgeId && !selectedJudge) {
        const targetJudge = judges.find(j => j.id === targetJudgeId);
        if (targetJudge) {
          // 다이렉트 렌더링 시에도 라우팅 일관성을 위해 스택 삽입
          window.history.pushState({ type: 'judge', tab: 'map', judgeId: targetJudge.id }, ''); 
          setSelectedJudge(targetJudge); 
          window.history.replaceState({ type: 'judge', tab: 'map', judgeId: targetJudge.id }, document.title, window.location.pathname);
        }
      }
    }
  }, [judges]);
  
  // [Callback] Infinite Scroll: 리스트 하단 DOM Intersection 관측
  const lastElementRef = useCallback(node => {
    if (isLoadingData) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setDisplayCount(prev => prev + 10);
    });
    
    if (node) observer.current.observe(node);
  }, [isLoadingData]);

  // [Effect] Firestore Realtime Database Subscription
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

  // [Effect] ECharts Map 인스턴스 초기화 및 이벤트 리스너 바인딩
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
              // 터치 디바이스에서의 핀치 줌 최적화 파라미터 적용
              animationDurationUpdate: 300,
              animationEasingUpdate: 'cubicInOut',
              tooltip: { show: false },
              series: [{
                type: 'map', map: 'korea', roam: true, 
                // [Tuning] 스케일 리미트 최댓값을 제한하여 핀치 시 화면을 이탈하는 과도한 줌 현상 방지
                scaleLimit: { min: 1.45, max: 2.5 }, 
                zoom: 1.45, center: [127.7, 36.3], selectedMode: 'single',
                label: { show: true, fontSize: 11, fontWeight: 'bold', color: '#94a3b8', formatter: (params) => regionMapping[params.name] || params.name },
                itemStyle: { areaColor: '#1e293b', borderColor: '#334155', borderWidth: 1.5 },
                emphasis: { label: { color: '#ffffff' }, itemStyle: { areaColor: '#3b82f6' } },
                select: { label: { color: '#ffffff', fontWeight: 'bold' }, itemStyle: { areaColor: '#2563eb' } }
              }]
            });
            
            myChart.on('click', function (params) {
              if (params.event && params.event.stop) {
                params.event.stop(); // 이벤트 버블링에 의한 하위 요소 동시 클릭 트리거 방지
              }
              const region = regionMapping[params.name] || params.name;
              
              // 맵 인터랙션으로 지역 모달 호출 시 스택 보강
              window.history.pushState({ type: 'region', tab: 'map', region }, '');
              setSelectedRegionName(region);
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

  const handleLogin = () => {
    signInWithPopup(auth, googleProvider)
      .then((result) => {
        setUser(result.user);
        showToast("로그인 성공!");
      })
      .catch((error) => {
        if (error.code === 'auth/popup-blocked') {
          alert("팝업이 차단되었습니다. 사파리/크롬 등 일반 브라우저를 사용해주세요.");
        } else if (error.code !== 'auth/popup-closed-by-user') {
          alert("로그인 실패: " + error.message);
        }
      });
  };

  const handleLogout = async () => {
    if (window.confirm("로그아웃하시겠습니까?")) {
      await signOut(auth); showToast("로그아웃 되었습니다."); handleTabChange('map');
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
      handleTabChange('map');
    } catch (error) { showToast(`등록 실패`, "error"); } finally { setIsSubmitting(false); }
  };

  const handleDeleteJudge = async (judgeId, judgeName) => {
    if (window.confirm(`정말 ${judgeName} 판사 데이터를 영구 삭제하시겠습니까?`)) {
      try { await deleteDoc(doc(db, "judges", judgeId)); showToast("데이터가 삭제되었습니다."); } 
      catch (error) { showToast("삭제 중 오류가 발생했습니다.", "error"); }
    }
  };

  // 메모리 상의 파이어베이스 데이터를 현재 View 요구사항에 맞게 매핑
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

  // 초기 렌더링 방지 구간 (Splash)
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
      
      {/* Toast Notification Container */}
      <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[9999] transition-all duration-300 pointer-events-none ${toast.show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
        <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl border ${toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-800 border-slate-700 text-white'}`}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} className="text-emerald-400" />}
          <span className="text-xs font-bold whitespace-nowrap">{toast.message}</span>
        </div>
      </div>

      <header className="w-full max-w-md bg-[#0F172A] border-b border-slate-800 p-4 flex justify-between items-center z-10 shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600/20 p-2 rounded-lg"><Scale className="text-blue-500" size={22} /></div>
          <div><h1 className="text-white font-extrabold text-lg tracking-tight leading-tight">JUDGE MAP V1.10</h1><p className="text-slate-400 text-[10px] mt-0.5">법관 통합 정보 생태계</p></div>
        </div>
        <div>
          {user ? (
            <button onClick={handleLogout} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-full text-xs font-bold transition border border-slate-700 shadow-sm"><img src={user.photoURL} alt="profile" className="w-5 h-5 rounded-full" /> 로그아웃</button>
          ) : (
            <button onClick={handleLogin} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-full text-xs font-bold transition shadow-md"><LogIn size={14} /> 로그인</button>
          )}
        </div>
      </header>

      {/* Tab: Map View */}
      {currentTab === 'map' && (
        <div className="w-full max-w-md flex-1 flex flex-col relative px-2">
          <div className="relative w-full flex-1 flex items-center justify-center min-h-[400px]">
            {mapStatus === "loading" && <p className="text-blue-400 text-sm font-bold animate-pulse absolute z-0">지도를 불러오는 중...</p>}
            {/* selectedRegionName 존재 여부로 하위 지도 터치 이벤트 패스스루 방지 */}
            <div ref={mapRef} style={{ width: '100%', height: '100%', pointerEvents: selectedRegionName ? 'none' : 'auto' }} className={`w-full z-0 transition-opacity duration-500 ${mapStatus === 'success' ? 'opacity-100' : 'opacity-0'}`}></div>
          </div>
          <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-slate-800/80 backdrop-blur border border-slate-700 text-slate-300 px-4 py-1.5 rounded-full text-[11px] font-bold pointer-events-none shadow-lg whitespace-nowrap">지역을 터치하거나 줌인하세요</div>

          {/* Sub View: Region Judge List (BottomSheet) */}
          {selectedRegionName && !selectedJudge && (
            <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300">
              <div style={{ transform: `translateY(-${keyboardOffset}px)` }} className="w-full max-w-md bg-slate-50 rounded-t-3xl shadow-2xl flex flex-col h-[80dvh] transition-transform duration-300">
                <div className="p-4 pb-3 border-b border-slate-200 bg-white rounded-t-3xl shrink-0 flex justify-between items-center">
                  <h2 className="text-base font-bold flex items-center gap-2 text-slate-900 ml-1"><MapPin className="text-blue-600 inline" size={18} /> {selectedRegionName} 관할 법관 ({isLoadingData ? '-' : regionJudges.length})</h2>
                  {/* 모달 닫기 제어를 브라우저 History 제어로 위임하여 상태 일관성 확보 */}
                  <button onClick={() => window.history.back()} className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-500"><X size={20} /></button>
                </div>
                
                {/* overscroll 속성 부여 및 컨테이너 높이 강제 초과 할당을 통한 Rubber-band 이펙트 구현 */}
                <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar overscroll-y-contain">
                  <div className="min-h-[calc(100%+1px)] flex flex-col gap-3">
                    {isLoadingData ? (
                      <>
                        {[1, 2, 3, 4].map(i => <JudgeSkeletonCard key={i} />)}
                      </>
                    ) : regionJudges.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 bg-white rounded-2xl border border-slate-200">
                        <p className="text-sm font-bold text-slate-500 mb-3">등록된 데이터가 없습니다.</p>
                        <button onClick={() => { handleTabChange('register'); }} className="text-xs bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-700">신규 등록하기</button>
                      </div>
                    ) : (
                      <>
                        {regionJudges.slice(0, displayCount).map(j => (
                          <div key={j.id} onClick={() => handleJudgeClick(j)} className="bg-white border border-slate-200 p-4 rounded-2xl flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 shadow-sm group animate-fade-in">
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
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Search */}
      {currentTab === 'search' && (
        <div className="w-full max-w-md flex-1 flex flex-col bg-slate-50 h-[100dvh] overflow-hidden">
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
          
          <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar touch-auto overscroll-y-contain">
            <div className="min-h-[calc(100%+1px)] flex flex-col gap-3 pb-6">
              {isLoadingData ? (
                <>
                  {[1, 2, 3, 4, 5].map(i => <JudgeSkeletonCard key={i} />)}
                </>
              ) : searchedJudges.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-10">검색 결과가 없습니다.</p>
              ) : (
                <>
                  {searchedJudges.slice(0, displayCount).map(j => (
                    <div key={j.id} onClick={() => handleJudgeClick(j)} className="bg-white border border-slate-200 p-4 rounded-2xl flex justify-between items-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 shadow-sm group animate-fade-in">
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
          </div>
        </div>
      )}

      {/* Tab: Register Form */}
      {currentTab === 'register' && (
        <div className="w-full max-w-md flex-1 overflow-y-auto px-4 py-4 custom-scrollbar bg-slate-50 overscroll-y-contain">
          <div className="min-h-[calc(100%+1px)]">
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
        </div>
      )}

      {/* Tab: My Page */}
      {currentTab === 'mypage' && (
        <div className="w-full max-w-md flex-1 overflow-y-auto bg-slate-50 custom-scrollbar overscroll-y-contain">
          <div className="min-h-[calc(100%+1px)]">
            {!user ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center pt-[30%]"><UserCircle className="text-slate-300 mb-4" size={48} /><p className="text-lg font-bold text-slate-700 mb-2">로그인이 필요합니다</p><button onClick={handleLogin} className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md mt-4">구글로 로그인</button></div>
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
                        <div key={idx} onClick={() => { 
                          const judge = judges.find(j => j.id === rev.judgeId); 
                          if(judge) handleJudgeClick(judge);
                        }} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm cursor-pointer hover:border-blue-300">
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
        </div>
      )}

      {/* Judge Detail Modal Rendering */}
      {selectedJudge && (
        <JudgeDetailModal 
          key={selectedJudge.id} 
          judge={selectedJudge} 
          keyboardOffset={keyboardOffset} 
          allJudges={judges} 
          user={user} 
          // 모달의 자체 닫기 액션 역시 브라우저 히스토리 팝 이벤트를 유도하여 사이드 이펙트 방어
          onClose={() => window.history.back()}
          showToast={showToast} 
          currentTab={currentTab} 
          selectedRegionName={selectedRegionName} 
        />
      )}
      
      {/* Admin Modification Modal */}
      {editModalJudge && <AdminEditModal judge={editModalJudge} keyboardOffset={keyboardOffset} onClose={() => setEditModalJudge(null)} showToast={showToast} />}

      {/* Global Bottom Navigation */}
      <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-slate-200 flex justify-between items-center px-4 pb-[max(env(safe-area-inset-bottom),12px)] z-40 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.05)]">
        <button onClick={() => handleTabChange('map')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'map' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><MapIcon size={20} className="mb-1" /><span className="text-[9px] font-bold">지도 검색</span></button>
        <button onClick={() => handleTabChange('search')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'search' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><Search size={20} className="mb-1" /><span className="text-[9px] font-bold">통합 검색</span></button>
        <button onClick={() => handleTabChange('register')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'register' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><PlusCircle size={20} className="mb-1" /><span className="text-[9px] font-bold">판사 등록</span></button>
        <button onClick={() => handleTabChange('mypage')} className={`flex flex-col items-center p-2 w-1/4 transition-colors ${currentTab === 'mypage' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><UserCircle size={20} className="mb-1" /><span className="text-[9px] font-bold">마이페이지</span></button>
      </nav>
    </div>
  );
}