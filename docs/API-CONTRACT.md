# APFS /api/v1 계약 — 로컬 구현, DB hardening 미적용

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
| `/sessions/:id` | PATCH | host/admin 또는 배정 consultant. 기업 재연결·updated_by 위조 불가 |
| `/sessions/:id` | DELETE | host/admin |
| `/profiles` | GET | host/admin. 이메일 제외 |
| `/profiles/:id` | PATCH | host/admin. host 대상/host 지정은 host만, host 자기 접근 해제 금지 |
| `/audit?company_id=UUID` | GET | host/admin. 이벤트 메타데이터만. 최대 100개 |

회사 응답/입력에서 대표자·연락처·이메일·사업자번호·주소·매출·내부 메모·source_payload를 제외한다. API projection만으로 직접 Data API 접근까지 보호되는 것은 아니다. 별도 `supabase/drafts/20261117_api_rls_hardening.sql`의 컬럼 권한/RLS 보완을 승인 적용해야 이 경계가 DB에도 강제된다.

진단 신규 1회, 컨설팅 신규 1~3회. 기존 4회차는 조회하고 일정/보고 상태를 고칠 수 있으나 새로운 4회차나 유형/회차 재정의는 차단한다. 보고 상태는 미제출/작성 중/검토 중/제출 완료. report_note는 4000자 이내이며 개인정보 입력을 금지한다. 파일이 업로드된 상태를 의미하지 않는다.

`capabilities.departureBase=false`, `reportFiles=false`, `rlsMigrationApplied=false`는 초안 미적용 상태를 명확히 나타낸다. Supabase 현재 테이블에는 departure_base 컬럼이 없다. 새 field를 보내면 400이며 실제 파일 업로드·영구 저장·주소 최적화를 완료했다고 표시하지 않는다.

## 읽기 전용 메타데이터 확인

2026-11-17 connector로 확인: companies 235, consultation_sessions 156, profiles 0, audit_events 0. 네 테이블 RLS 활성. 실제 행은 조회하지 않았다. 현재 운영 권한은 authenticated에 전체 컬럼 권한이 있고 client가 넣는 감사 이벤트 정책도 있어 hardening이 필요하다. 새 SQL 초안은 적용하지 않았다.

## 참고

- [Supabase 사용자 검증](https://supabase.com/docs/reference/javascript/auth-getuser)
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [컬럼 수준 보안](https://supabase.com/docs/guides/database/postgres/column-level-security)

## 이번 단계의 실제 검증 결과

- `npm run test:rls`: **22/22 통과**, 실패 0. `@electric-sql/pglite@0.5.16`의 메모리 PostgreSQL에 원본 snapshot과 새 hardening 초안을 실제 적용했다. 권한을 `authenticated`로 바꾼 직접 SQL 요청으로 host/admin/consultant/client/pending/inactive 범위를 검사했다.
- 단순 UI 조건 검사가 아니다. 역할별 SELECT/INSERT/UPDATE/DELETE, host 지정·자기 접근 보존, 미승인 계정 차단, 배정 범위, 개인정보 컬럼 권한, 위조 감사 이벤트 거부, 중복·신규 회차 한도, 기존 4회차 보존을 DB 엔진에서 확인했다.
- 이 테스트는 새 합성 기업/상담 몇 개만 메모리에 만들고 종료한다. 기존 235개 기업·156개 상담은 복사·읽기·변경하지 않는다. 실제 Supabase JWT 발급/Google 인증·PostgREST 동작까지 대체하는 검증은 아니다.
- API 입력·권한 순수 함수 합성 검사 15개와 서버 파일 `node --check` 2개도 통과했다. API 실제 배포/로그인 후 업무 CRUD 결과는 별도로 확인해야 한다.
- Supabase 공개 Auth settings 읽기 결과: email enabled, Google disabled, signup enabled, email auto-confirm disabled. 계정이나 OAuth 설정은 만들거나 바꾸지 않았다. 로그인 이메일 검증 후 최초 host를 승인 지정하는 콘솔 단계가 남아 있다.
