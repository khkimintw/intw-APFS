# P1 농금원 — 진행 기록 (2026-11-17)

## 1. 조사 완료

- 시작 HEAD: b8a5cb6. 시작 작업 트리는 깨끗했다. AGENTS.md는 발견되지 않았다. README·PLAN·실제 코드·스키마를 읽고 기존 인증/승인/CRUD를 확장했다.
- origin fetch intween/intw-APFS, push khkimintw/intw-APFS + intween/intw-APFS 구성을 변경하지 않았다.
- 운영 메타데이터 집계: companies 235, consultation_sessions 156, profiles 0, audit_events 0. 네 테이블 RLS 활성. 원본 행·연락처는 조회하지 않았다.
- 운영 Auth 공개 설정: 이메일 로그인 활성, Google 비활성, 가입 가능, 이메일 확인 필수. 비밀값은 읽거나 출력하지 않았다.

## 2. MVP 구현 완료 — 로컬 변경

- 로그인/승인대기/활성 상태, host/admin/user + consultant/client 화면 유지. 업무 데이터는 /api/v1 서버로 통일했다.
- 서버 Auth getUser + 승인/활성/역할/배정 범위 검사 후 사용자 bearer로 RLS 요청한다. service key를 사용하지 않는다.
- 경영체 검색/필터·배정·CRUD, 회차 일정/비대면/보고상태/업무메모·CRUD, 사용자 승인/활성/권한, 관리자 KPI/감사 목록을 연결했다. 신규 진단1·컨설팅3 제한과 중복 차단을 적용하고 기존4회차는 보존한다.
- 업무 화면/API에서 개인이메일·연락처·주소·주민번호·생년월일·원본 payload·관리자 notes를 제외했다. 인증 입력 이메일은 인증 서비스에만 전달한다.
- 신규 출발거점·파일 Storage는 비활성이다. UI 데모 경로/가짜 API를 제공하지 않는다. 기존 미사용 합성 모듈은 실행 경로에서 참조하지 않는다.

## 3. 통합 검증

- npm run build 성공. HTTP 및 최종 검증 결과는 README 후속 기록에 남긴다.
- npm run test:rls: PGlite 실제 PostgreSQL 실행엔진에서 합성 역할/행으로 22/22 통과. 운영 Auth 세션을 대신하는 검증은 아니다.
- RLS/컬럼권한/서버검사/중복·회차·감사 트리거/기존4회차 보존을 확인했다. 운영 DB의 235/156 행은 변경하지 않았다.

## 4. 마지막 연결 단계 — 아직 실행하지 않음

- SQL hardening 초안의 컬럼권한 축소는 기존 배포의 select *와 호환되지 않는다. 새 API/UI 배포와 동일한 전환 계획으로만 적용한다. 대상·영향·복구는 supabase/drafts의 ROLLBACK 문서를 따른다.
- 이메일 인증을 마친 khkim 계정의 UUID를 Auth 콘솔에서 확인해 최초 host를 지정한다. 계정 비밀번호를 대화나 명령 인자로 요청하지 않는다.
- 승인된 합성 계정으로 운영 JWT 로그인→pending→host 승인→역할별 CRUD/RLS를 마지막에 확인한다. 현재 profiles0이므로 실제 계정 흐름을 통과했다고 주장하지 않는다.
- Google Client ID/Secret·redirect는 콘솔 단계다. 기존 데이터 변경·push·배포·요금제/프로젝트·터널 설정 변경은 하지 않았다.
