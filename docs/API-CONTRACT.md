# APFS /api/v1 계약 — 서버 인증·권한 검사 적용

클라이언트 데이터 CRUD는 서버 API를 사용한다. 로그인은 기존 Supabase Auth를 유지한다. 모든 요청은 `Authorization: Bearer <현재 사용자 access token>`이 필요하다. 토큰은 문서·로그·URL에 넣지 않는다. 서버는 `auth.getUser(token)`로 검증하고 `profiles`의 승인·활성을 재확인한다. 사용자 bearer를 그대로 RLS 쿼리에 사용하며 service role은 사용하지 않는다.

응답은 `{data, requestId}`. 오류는 `{error:{code,message},requestId}`이며 원본 DB 오류·문서·개인정보를 반환하지 않는다. 응답은 `Cache-Control: no-store`. JSON 본문 최대 32KB, 정의되지 않은 필드·잘못된 UUID·잘못된 날짜는 400. 변경 요청의 다른 Origin은 403. 분산 rate limit은 아직 구현되지 않았으며 운영 공개 전 공급자/저장소 선택이 필요하다.

| 경로 | 메서드 | 권한 및 동작 |
| --- | --- | --- |
| `/me` | GET | 검증된 본인 프로필. pending/중지 상태도 반환하고 업무 진입은 금지. capabilities 함께 반환 |
| `/companies` | GET | host/admin 전체, consultant 본인 배정, client 본인 기업. 최대 1000개 |
| `/companies` | POST | host/admin. safe 필드만 새 기업 생성 |
| `/companies/:id` | GET | 본인 접근 범위 |
| `/companies/:id` | PATCH/DELETE | host/admin. 연결 회차 있으면 삭제 409 차단 |
| `/companies/:id/sessions` | GET | 본인 접근 범위 |
| `/companies/:id/sessions` | POST | host/admin 또는 해당 기업 배정 consultant. 중복은 409, upsert 없음 |
| `/sessions/:id` | GET | 본인 접근 범위 |
| sessions/:id/report | GET/POST | 본인 접근 범위에서 서명 다운로드 또는 보고서 업로드 (PDF/HWP/HWPX/DOC/DOCX/XLS/XLSX, 20MB 이하) |
| sessions/:id/report | GET/POST | 본인 접근 범위에서 서명 다운로드 또는 보고서 업로드 (PDF/HWP/HWPX/DOC/DOCX/XLS/XLSX, 20MB 이하) |
| `/sessions/:id` | PATCH | host/admin 또는 배정 consultant. 기업 재연결·updated_by 위조 불가 |
| `/sessions/:id` | DELETE | host/admin |
| `/profiles` | GET | host/admin. 이메일 제외 |
| `/profiles/:id` | PATCH | host/admin. host 대상/host 지정은 host만, host 자기 접근 해제 금지 |
| `/audit?company_id=UUID` | GET | host/admin. 이벤트 메타데이터만. 최대 100개 |

경영체 응답에는 공개 사업자번호를 그대로 포함한다. 대표자·담당자 연락처, 주소, 매출, 내부 메모, 원본 시트의 추가 열은 별도 company_admin_private에 저장하며 host/admin만 서버 API에서 조회·수정한다. client/consultant 응답은 private fields를 포함하지 않는다.

진단 신규 1회, 컨설팅 신규 1~3회. 기존 4회차는 조회하고 일정/보고 상태를 고칠 수 있으나 새로운 4회차나 유형/회차 재정의는 차단한다. 보고 상태는 미제출/작성 중/검토 중/제출 완료. report_note는 4000자 이내이며 개인정보 입력을 금지한다. 파일이 업로드된 상태를 의미하지 않는다.

capabilities.departureBase=true와 reportFiles=true는 방문 거점 입력과 회차 보고서 파일 저장을 지원한다는 의미다. 보고서는 비공개 consultation-reports 버킷에 저장하고 배정 컨설턴트 또는 관리자만 접근한다. 다운로드 링크는 60초 만료 서명 URL이다. 전체 스키마 RLS hardening 상태는 별도 검토 대상으로 남아 있어 rlsMigrationApplied=false를 유지한다.

## 읽기 전용 메타데이터 확인

2026-11-17 connector로 확인: companies 235, consultation_sessions 156, profiles 0, audit_events 0. 네 테이블 RLS 활성. 실제 행은 조회하지 않았다. 현재 운영 권한은 authenticated에 전체 컬럼 권한이 있고 client가 넣는 감사 이벤트 정책도 있어 hardening이 필요하다. 새 SQL 초안은 적용하지 않았다.

## 참고

- [Supabase 사용자 검증](https://supabase.com/docs/reference/javascript/auth-getuser)
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [컬럼 수준 보안](https://supabase.com/docs/guides/database/postgres/column-level-security)

## 2026-11-19 구현 상태

- Supabase에는 import batch/history/undo, private company fields, source sheet payload, IR schedule/confirmation, visit time/confirmation, report file metadata와 private Storage bucket/policies를 추가했다.
- 업로드 이력은 actor/file/time/counts를 기록한다. 가져오기 되돌리기는 수정되거나 회차가 연결된 배치를 차단한다.
- 회차 보고서는 브라우저에서 Supabase private Storage로 직접 업로드한다. Vercel Function을 통과하지 않아 4.5MB 요청 한도에 걸리지 않는다. API는 업로드 파일 경로를 확인한 뒤 회차 메타데이터를 기록하고 다운로드에 60초 signed URL을 쓴다.
- Pseudo User/Admin 데이터는 현재 브라우저 localStorage에만 저장한다. 이 모드에서 실 Supabase API를 호출하지 않는다.
- 프로덕션 빌드는 성공했고 commit de41115를 khkimintw/intw-APFS와 intween/intw-APFS main에 push했다. Vercel 배포가 시작되도록 push했지만, 운영 URL은 SSO 보호로 로그인 화면에 리디렉션되어 이 세션에서는 새 배포 상태를 확인할 수 없다.

## 남은 작업

- 농금원 암호 Excel의 자동 열기와 오래된 XLS 파서는 샘플 파일 형식을 확인해야 한다. 현재 암호 없는 XLSX/CSV만 지원한다.
- 사업자번호로 주소 자동 검색은 외부 주소/사업자 API와 키가 없어 미구현이다. 주소 직접 편집·확인·잠금과 지도 링크는 제공한다.
- 앱 자체 이메일 발송은 미구현이며 메일 앱 작성 링크만 있다.
- 경로 자동 최적화는 미구현이다. 컨설턴트가 입력한 출발 거점과 주소로 Google 지도 링크를 연다.
- 전체 direct Data API 접근과 역할별 RLS는 추가 점검이 필요하다. OAuth 실제 로그인, Vercel 최종 배포/브라우저 검증도 배포 뒤 확인한다.
