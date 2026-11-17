// 실제 기업·컨설턴트·사업자번호·연락처가 없는 합성 예시.
export const consultants = ['미배정', '합성 컨설턴트 A', '합성 컨설턴트 B'];
export const initialCompanies = [
  { id:'DEMO-01', name:'합성 경영체 가', consultant:'합성 컨설턴트 A', direct:false, status:'컨설팅 진행', visits:[{id:'v1',type:'진단',round:1,date:'미정',origin:'합성 출발지 A',report:'제출 시연'},{id:'v2',type:'컨설팅',round:1,date:'미정',origin:'합성 출발지 A',report:'미제출'}]},
  { id:'DEMO-02', name:'합성 경영체 나', consultant:'합성 컨설턴트 B', direct:true, status:'IR 검토 대기', visits:[{id:'v3',type:'진단',round:1,date:'미정',origin:'합성 출발지 B',report:'제출 시연'}]},
  { id:'DEMO-03', name:'합성 경영체 다', consultant:'미배정', direct:false, status:'배정 대기', visits:[]},
];
export const importCandidates = [
  {id:'i1',companyId:'DEMO-01',name:'합성 경영체 가',type:'컨설팅',round:1},
  {id:'i2',companyId:'DEMO-03',name:'합성 경영체 다',type:'진단',round:1},
  {id:'i3',companyId:'DEMO-03',name:'합성 경영체 다',type:'진단',round:1},
];
