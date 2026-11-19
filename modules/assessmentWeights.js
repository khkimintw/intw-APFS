export const SURVEY_RESPONSE_COUNT = 10;
export const ASSESSMENT_RUBRIC = [
  { id: 'team', label: '팀 역량', weight: 24.1, indicators: [
    { id: 'T1', label: '문제 해결 역량', weight: 21.1 },
    { id: 'T2', label: '도메인 전문성', weight: 24.3 },
    { id: 'T3', label: '과거 실행 경험 또는 성과', weight: 21.1 },
    { id: 'T4', label: '팀의 실행 속도와 학습 능력', weight: 18.4 },
    { id: 'T5', label: '조직 확장 가능성', weight: 15.1 },
  ]},
  { id: 'problem', label: '문제/솔루션 적합성', weight: 20.0, indicators: [
    { id: 'P1', label: '고객 문제 정의의 명확성', weight: 21.4 },
    { id: 'P2', label: '고객 Pain Point의 강도', weight: 16.4 },
    { id: 'P3', label: '타깃 고객의 구체성', weight: 17.6 },
    { id: 'P4', label: '문제와 솔루션의 연결성', weight: 21.4 },
    { id: 'P5', label: '제품/MVP 또는 서비스 구현 수준', weight: 23.3 },
  ]},
  { id: 'market', label: '시장/경쟁력', weight: 21.8, indicators: [
    { id: 'M1', label: '시장 규모 및 성장성', weight: 27.0 },
    { id: 'M2', label: 'TAM/SAM/SOM 또는 목표시장 세분화', weight: 20.9 },
    { id: 'M3', label: '타깃 시장 진입 가능성', weight: 16.6 },
    { id: 'M4', label: '경쟁사 및 대체재 이해도', weight: 17.2 },
    { id: 'M5', label: '경쟁사 대비 차별성 또는 방어력', weight: 18.4 },
  ]},
  { id: 'traction', label: '트랙션/검증근거', weight: 18.2, indicators: [
    { id: 'V1', label: '고객 인터뷰 또는 VOC', weight: 19.8 },
    { id: 'V2', label: 'MVP 테스트, PoC, 파일럿, 실증 결과', weight: 20.4 },
    { id: 'V3', label: '사용자 수, 가입자 수, 활성 사용자 등 사용 지표', weight: 17.9 },
    { id: 'V4', label: '매출, 유료고객, 계약, 재구매 등 수익 검증', weight: 22.8 },
    { id: 'V5', label: 'MOU, LOI, 파트너십, 수상, 투자 등 외부 검증', weight: 19.1 },
  ]},
  { id: 'business', label: 'BM/GTM/투자계획', weight: 15.9, indicators: [
    { id: 'B1', label: '수익모델의 명확성', weight: 21.7 },
    { id: 'B2', label: '가격정책 또는 매출 산식', weight: 22.3 },
    { id: 'B3', label: 'GTM 전략 및 고객 확보 채널', weight: 18.5 },
    { id: 'B4', label: '성장 로드맵 및 마일스톤', weight: 19.1 },
    { id: 'B5', label: '투자금 규모와 사용계획', weight: 18.5 },
  ]},
];
export const CRITICAL_AXES = [
  { id: 'problem', label: '문제/솔루션 적합성', respondents: 6 },
  { id: 'team', label: '팀 역량', respondents: 5 },
  { id: 'market', label: '시장/경쟁력', respondents: 4 },
];
export const EARLY_STAGE_COMPENSABLE_AXES = [
  { id: 'traction', label: '트랙션/검증근거', respondents: 4 },
  { id: 'business', label: 'BM/GTM/투자계획', respondents: 4 },
  { id: 'problem', label: '문제/솔루션 적합성', respondents: 3 },
];
