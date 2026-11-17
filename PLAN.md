# 농금원 워크플로우 — 인수 조사 및 구현 계획

## 현재 상태

HEAD 76a2ae3, main. 앱과 개발 명령은 아직 없다. 사용자 기록상 Vercel intw-apfs는 khkimintw/intw-APFS에 연결되어 있고 별도 서울 Supabase 프로젝트가 있으나 실제 Auth/RLS/환경변수/배포는 미확인이다. 기존 README의 관리자·컨설턴트 경계를 유지한다.

## 인계 자료와 확인 한계

- 로컬 인계 PDF 3개는 각각 9/6/6쪽이다. 6쪽짜리 농금원 인계서 두 파일은 SHA-256이 동일하다. 원문과 계정정보는 저장소에 복사하지 않는다.
- 농금원 인계서에서 진단 1회·컨설팅 최대 3회 문구를 확인했다. 초기 회차 정책은 이를 따르고 최대 4회 확장은 운영 확인 전 활성화하지 않는다.
- 별도 인계서에 25개 지표 언급이 있으나 지표별 정의·점수·요약 기준·공급자 API는 미확인이다. 지표 내용을 창작하지 않는다. PPT/PDF 언급은 있으나 실제 변환 지원·성공 여부는 확인되지 않았다.
- Figma는 읽기 도구 접근 실패로 화면 구조·시각 규칙을 확인하지 못했다. 디자인 파일은 변경하지 않았다. 접근 전에는 일관된 한국어 기본 UI로 준비하고 Figma 일치라고 표시하지 않는다.
- 참고 메모의 Sheet 링크는 HEAD 응답 200만 확인했다. 본문·실제 행·탭·헤더를 읽지 않았으므로 권한·열 매핑을 확인했다고 주장하지 않는다. 원본 이름/연락처/사업자번호/IR/정산 행을 복사하지 않는다. Sheet 구조 확인은 행이 노출되지 않는 방식이 확보된 뒤 수행한다. OAuth·공유 권한·쓰기 연동은 보류한다.
- 기존 운영 사이트와 저장소 동작 차이는 운영 사이트 접근 정보가 미확인이라 비교하지 못했다.

## MVP와 업무 경계

- 첫 여정은 합성 주간 업로드 미리보기 → 열 매핑/중복 검토 → 기업 등록안 → 컨설턴트 배정 → 내 배정 기업의 회차별 보고서 제출 상태이다. 실데이터 import·DB 쓰기·외부 AI 실행은 포함하지 않는다.
- 관리자 화면은 KPI, 업로드/이력/중복, 기업 목록/상세/상태 이력, 배정/일정/방문 순서, 보고 누락, 투자사 의견/점수/PDF, 주간 보고/정산의 7종으로 확장한다. 컨설턴트는 내 기업/알림과 기업 상세/IR/분석본/회차 보고/방문 일정의 2종이다.
- 9단계는 업로드 → 주소 확인 → 분석 → 배정/방문 순서 → 회차 컨설팅 → 보고 확인 → IR 선발 → 투자사 검토 → 농금원 보고/정산이다. IR 직행은 상태가 아닌 독립 필터 태그다.
- 관리자만 계정을 발급하며 경영체 로그인은 없다. 컨설턴트는 배정된 기업만 접근한다. 관리자 메모·정산·단가·지급·KPI는 별도 관리자 전용 테이블/API/내보내기 경계로 분리한다. UI 숨김이나 클라이언트 역할 전환을 보안으로 취급하지 않는다.
- KPI 목표는 진단 90건·컨설팅 330건·IR 15건·월 30건 페이스이며 관리자 전용이다. 단가는 소스·클라이언트 합성 bundle 대신 관리자 전용 서버 설정/DB에 두고 실제 값은 공개 계획에 복제하지 않는다.
- modules: imports, companies, assignments, visits, consultations, reports, analysis, ir_reviews, admin_finance. 데이터 초안: profiles/companies/company_status_events/import_batches/import_candidates/assignments/availability/visits/consultation_sessions/files/analysis_jobs/ir_reviews/admin_notes/admin_rates/settlements/audit_events.
- /api/v1/imports, companies, assignments, availability, visits, consultations, reports, analysis-jobs, ir-reviews 및 별도 admin 전용 kpi/settlements를 설계한다. 서버 역할 검사·배정 범위와 RLS를 매 요청에 적용하고 private Storage도 같은 경계로 보호한다. 이 설계는 아직 적용되지 않았다.
- 컨설턴트 일정은 본인 입력, 관리자 대리 입력을 지원하도록 설계하며 방문 회차마다 출발 기준지를 저장한다. 검증된 좌표가 있을 때만 직선거리/단순 순서 및 지도 링크를 제공하고 관리자 수정을 허용한다. 도로 시간 최적화로 표시하지 않는다.
- 사업자번호를 외부 전송하지 않고 주소 후보·관리자 수동 확정부터 제공한다. 사수래AI adapter는 비활성 실제 공급자와 명확히 표시된 목업으로 분리한다. 변환 실패는 실패 사유/재시도 안내를 표시하며 성공 분석처럼 다루지 않는다.

## 우선순위 및 사용자 결정

P0: 역할/배정 경계·합성 기업/회차 UI·중복 검토. P1: 보고서 상태/감사 이력·방문 일정. P2: 승인된 Supabase Auth/RLS/Storage 연결. P3: 관리자 KPI/정산·IR/PDF·실제 API adapter.

25개 지표 세부 명세, 업로드/정산 열 구조, 실제 운영 사이트 차이, 공급자 계약·PPT 지원, 주소/지도 API 비용과 근거, 보존기간, 계정 발급 정책이 남았다. Sheet 실제 행 접근 필요 시 목적과 범위를 먼저 보고하며 권한을 확대하지 않는다.

## 확인 근거와 한계 (2026-11-17)

- 읽기 전용 조사 후 작성한 로컬 초안이다. 외부 리소스를 생성하거나 배포하지 않았다.
- origin fetch는 intween 백업, push는 khkimintw 배포 저장소와 intween 백업 두 대상이다. 설정을 변경하지 않았다. 배포 저장소는 GitHub 공개 API에서 Public/main으로 확인했다. 양쪽 원격 main과 로컬 HEAD가 일치했다.
- README.md에 기존 로컬 수정이 있다. 보존하며 덮어쓰지 않는다. 기존 추적 파일은 README.md뿐이며 package.json, 앱, AGENTS.md, Actions, 배포 설정은 없다.
- Git credential helper는 store이며 credential 파일 권한은 600이다. 파일 내용을 읽지 않았다. 공개 원격 읽기는 성공했지만 PAT 유효성·계정·push 권한을 증명하지 않는다. 인증 실패 시 토큰을 요청하거나 URL에 넣지 않고 중단한다.
- Node 22.22.1, npm 9.2.0, Git 2.53.0, Python 3.14.4가 있다. Docker/Podman/Caddy/Nginx/gh는 PATH에서 발견되지 않았다. SSH/Tailscale 데몬은 실행 중이다. Funnel 상태는 No serve config이며 기존 서비스·포트를 변경하지 않았다.
- Vercel/Supabase를 확인할 연결 브라우저가 없어 계정 화면은 재확인하지 못했다. 최신 사용자 기록상 khkim 계정의 Supabase intween 조직 Free 프로젝트 2개가 한도를 사용 중이다. 이전 develop 계정의 조직과 혼동하지 않는다. 새 프로젝트 생성·중지·삭제·업그레이드를 하지 않는다.
- 최신 사용자 기록상 Vercel intween_temp는 Hobby, 두 Git 연결은 완료, Production 배포는 없다. 현재 앱이 없어 작동하는 서비스 URL을 주장할 수 없다. 실제 plan·계정·production branch·배포 이력 확인은 배포 전 선행조건이다.

## 공통 구조와 보안 경계

- React + JavaScript/JSX 기반 Next.js 단일 앱을 권장한다. TypeScript 파일을 만들지 않는다. 의존성 버전·Node 지원 범위는 scaffold 시 공식 문서에서 확인하고 lockfile로 고정한다.
- app/ 화면 및 /api/v1, components/ 공통 UI, modules/ 업무 도메인, lib/server/ 인증·인가·데이터 접근, adapters/ 외부 공급자로 모듈화한다. 두 제품은 별도 저장소·Supabase·Vercel·환경변수를 유지한다.
- 한국어 타이포그래피·여백·폼·버튼·키보드 접근성·반응형 규칙은 일관되게 설계하되 제품 메뉴와 강조색은 분리한다.
- Supabase Auth, 관계형 데이터, private Storage와 파일 메타데이터를 사용한다. 모든 사용자 데이터와 Storage 경로에 RLS를 설계한다. 서버 권한 검사와 RLS를 함께 적용한다. 클라이언트는 publishable/anon key만 사용한다. service role은 클라이언트 코드에 두지 않는다.
- OpenAPI 문서에 /api/v1 경로, bearer 인증, 역할별 권한, 업로드 크기·형식, 요청 rate limit, 오류 코드·request ID, 감사 이벤트를 명시한다. 실제 제한 수치는 공급자 한도 확인 후 확정한다. 다중 인스턴스에서 프로세스 메모리만으로 rate limit을 보장한다고 표시하지 않는다.
- 감사 로그는 행위자·대상 내부 ID·시각·작업·결과만 기록하고 비밀값·문서 원문·연락처·정산 행을 로그에 남기지 않는다.
- GPU/장기 변환은 필요성이 확인될 때만 alphagpu stateless worker로 분리한다. private 파일, 짧은 signed URL, bounded upload, timeout/retry, health/readiness, 중복 실행 방지와 작업 상태부터 설계한다. 초기 메시지 브로커·분산 DB는 도입하지 않는다. HTTPS 공개는 별도 승인 전까지 하지 않는다.

## 외부 연결과 비용 선행조건

- 사용자 최신 기록상 기존 두 Supabase 프로젝트를 재사용한다. 실제 조직·활성 프로젝트 수·Free 저장공간/트래픽/인증 제한은 로그인된 계정에서 읽기 전용으로 확인해야 한다. 확인 전 추가 프로젝트 생성을 시도하지 않는다.
- Vercel Hobby의 내부 비상업 사용 범위, 배포 공개 범위와 현행 무료 한도를 배포 전에 확인한다. 한도 초과나 유료 기능이 필요하면 중단하고 영향·대안을 보고한다. Pro·유료 add-on은 사용하지 않는다.
- 외부 AI/API는 공급자·비용·보존/학습 정책·법적 근거·자격증명이 확인될 때까지 비활성화한다. 무료라는 가정으로 외부 전송을 켜지 않는다.
- 실제 키 값 없이 .env.example에 프로젝트별 Supabase URL/publishable key와 필요한 서버 환경변수 이름·설명만 작성한다. .env*, .vercel/, node_modules/, .next/, 업로드/내보내기/원문 자료를 .gitignore로 제외하고 .env.example만 예외로 둔다.

## 단계, 검토 및 승인

1. 현재 단계: 이 PLAN.md만 새로 작성한다. 기존 README 변경·원격 설정·Git index를 보존한다.
2. 다음 단계: 합성 데이터 기반 앱 scaffold와 핵심 사용자 여정, README 실행 안내, .env.example, .gitignore, API·권한·스키마 설계 초안을 로컬에 작성한다. 실제 DB 적용은 하지 않는다.
3. 앱 준비 후 프로젝트별 lint/build 및 PR checks용 Actions 초안을 로컬에 준비한다. 기존 테스트는 현재 없다. 테스트를 추가하거나 suite를 실행하지 않는다. 승인되지 않은 Actions 설정은 push하지 않는다.
4. 사용자 요청 전 테스트·검증 suite를 실행하지 않는다. 현재 build/lint/test 명령은 존재하지 않아 실행하지 않았다. scaffold 이후 실제 package scripts에 맞춰 npm ci, npm run dev -- --hostname 127.0.0.1, npm run lint, npm run build를 README에 문서화하되 존재/실행 여부를 구분한다.
5. 외부 공개 직전 대상 저장소·커밋·파일·환경변수 이름·공개 범위·비용·롤백을 제시하고 action-time 확인을 받는다. 현재 push/PR preview/Production/Tailscale 공개는 하지 않는다.

## 변경 영향과 롤백

- 이번 변경은 새 PLAN.md 하나이며 기존 코드/데이터와 충돌하지 않는다. 기존 README 수정이 이미 있으므로 전체 reset/clean/checkout을 하지 않는다. 원복이 필요하면 이번 PLAN.md만 검토 후 제거한다.
- scaffold 전에 현재 diff와 파일 목록을 확인하고 원문·secret을 포함하지 않는 로컬 백업/별도 작업 브랜치로 보존한다. 파일 교체는 변경 범위를 먼저 명시한다.
- DB migration은 초안 SQL과 RLS/역할 영향·백업 및 복원 절차를 검토한 뒤 별도 승인한다. 기존 데이터 변경·삭제를 기본 동작으로 하지 않는다.
- 공개 저장소에 올리기 전 tracked/untracked/staged 파일·diff·이력의 secret/개인정보를 검토한다. 이번 조사에서는 README 이력 각 3개 버전의 제한적 secret 패턴에 탐지가 없었다. 완전한 부재를 보장하는 검사는 아니다. 원문 인계서는 커밋하지 않는다.
- 승인된 git push origin은 두 원격에 쓰므로 각각 결과와 main tip을 확인한다. 한쪽 실패 시 자동 force push 없이 차이를 보고한다. Production 롤백은 이전 정상 배포로 복구하는 절차를 먼저 준비한다. 최초 배포에는 이전 정상 배포가 없음을 고려한다.


## 2026-11-17 로컬 MVP scaffold 후속 기록

위 조사·단계 계획은 당시 기록으로 보존한다. 후속 사용자 지시에 따라 Next.js JavaScript 앱, 제품별 합성 데이터와 상호작용 UI, .gitignore, 값이 비어 있는 .env.example, README 실행 안내를 로컬에 추가했다. 의존성은 고정 버전을 명시했으며 실제 설치·서버 실행·빌드·린트·테스트·git diff --check는 하지 않았다. 기존 README의 원격·배포 설명을 보존하고 현재 상태만 보완했다. 인증·API·DB/RLS·외부 공급자·영구 저장은 적용하지 않았으며 외부 변경은 없다. 코드 읽기 기준으로 MVP 동작 경로를 자체 검토했으나 브라우저 렌더링/실행 검증은 미수행이다.

원복 시 이번에 추가한 앱·설정 파일만 대상으로 검토하고, 문서는 저장소 밖에 보관한 작업 전 사본과 비교해 이번 보완만 되돌린다. 기존 미커밋 수정과 이 계획을 reset/clean으로 제거하지 않는다. 배포·migration 등 외부 변경은 별도 승인 전 계속 보류한다.
