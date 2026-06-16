export const regionMapping = {
  '서울특별시': '서울', '인천광역시': '인천', '경기도': '경기', '강원도': '강원',
  '충청북도': '충북', '충청남도': '충남', '대전광역시': '대전', '세종특별자치시': '세종',
  '전라북도': '전북', '전라남도': '전남', '광주광역시': '광주',
  '경상북도': '경북', '경상남도': '경남', '대구광역시': '대구', '부산광역시': '부산', '울산광역시': '울산',
  '제주특별자치도': '제주'
};

export const getAvgRating = (reviews) => {
  if (!reviews || reviews.length === 0) return "0.0";
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return (sum / reviews.length).toFixed(1);
};

export const formatDate = (isoString) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
};

export const getUserBadge = (reviewCount) => {
  if (reviewCount >= 5) return { icon: '🏅', text: '사법 감시단', color: 'text-amber-600 bg-amber-100' };
  if (reviewCount >= 1) return { icon: '⚖️', text: '우수 평가자', color: 'text-blue-600 bg-blue-100' };
  return { icon: '🌱', text: '초보 시민', color: 'text-emerald-600 bg-emerald-100' };
};