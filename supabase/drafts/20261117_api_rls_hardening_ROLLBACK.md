# 적용 전 승인 및 롤백 절차

이 폴더는 **미적용 검토 초안**이다. schema.sql은 당시 snapshot으로 보존한다. 운영 RLS가 snapshot과 일부 다르므로 snapshot 전체를 재실행하거나 즉흥적인 역방향 SQL을 실행하지 않는다.

## 적용 영향

- 235개 기업, 156개 상담 회차의 값은 UPDATE/DELETE하지 않는다. 기존 4회차도 남긴다.
- 기존 authenticated 전체 컬럼 권한을 최소 컬럼 권한으로 바꾸므로 예전 배포 코드의 `select('*')`는 실패한다. 새 API/UI 배포와 함께 반영해야 한다.
- 원본 메모·연락처·사업자번호·source_payload는 데이터베이스에 남지만 Data API app role에는 조회·수정 권한을 주지 않는다. 관리자가 해당 필드를 실제로 열람하는 기능도 이번 MVP에 없다.
- 단일 host 제한 index를 제거해 host가 다른 host를 지정할 수 있게 한다. 실제 host 변경은 승인된 기존 host만 수행하고 자기 승인·활성·host 지위 해제는 차단한다.
- 이메일 문자열만으로 host가 되는 signup trigger를 바꾼다. 기존 host는 보존하며, profiles가 0인 현재 최초 host 지정은 별도 콘솔 단계다.
- 감사 trigger는 적용 이후 변경만 기록한다. 이전 데이터의 이력을 만들어내지 않는다.

## 적용 전 자료 보관

1. SQL console/CLI의 관리자 전용 경로로 현재 `pg_policies`, 해당 테이블 ACL/column ACL, private 함수 정의, trigger 목록, profiles_single_host_idx 정의를 비공개 파일로 보관한다. 프로젝트 비밀번호·토큰을 명령 인자/로그에 넣지 않는다.
2. companies/consultation_sessions/profiles/audit_events 행 수를 기록한다. 기존 값의 복사본이 필요한 경우 개인자료가 Git 밖 private 저장소로만 향하도록 승인받는다.
3. 모든 기존 사용자 세션/클라이언트와 배포 롤백 대상을 확인한다. SQL은 `begin`~`commit` 한 트랜잭션이며 중간 오류 시 `rollback`한다.

## 롤백

- commit 전 실패: 해당 트랜잭션 `rollback`으로 원복한다.
- commit 후: 이전 API/UI로 되돌리기 전에 새로운 쓰기를 일시 중단한다. 새 trigger 7개와 guard 함수 4개, 감사 함수 1개의 의존성을 확인하고 이번 추가 객체만 제거한다. 적용 전 저장한 정확한 ACL·policy·bootstrap 함수 정의를 재적용한다. 임의로 이전 schema.sql 전체를 실행하지 않는다.
- 새 host가 여러 개 생겼다면 single-host index 복원은 실패한다. 계정을 자동 강등하거나 삭제하지 말고 host 유지 대상을 별도 결정한다. 데이터 손실 없이 현재 권한을 유지하는 롤백을 우선한다.
- 감사 이벤트는 롤백 때문에 지우지 않는다. 기업·상담 원본과 기존 프로필을 덮어쓰지 않는다.

## 최초 host 최종 단계

1. 사용자가 Supabase Auth에서 본인 계정을 만들고 이메일 검증 또는 승인된 OAuth 로그인을 완료한다.
2. 관리자가 Auth console에서 대상 user UUID와 이메일 검증 상태를 직접 확인한다. 대화나 Git에 비밀번호·access token을 전달하지 않는다.
3. 승인된 관리자 SQL 세션에서 그 UUID 하나의 profile을 host/approved/active로 지정한다. 프로필이 없으면 trigger/계정 생성 경로를 확인한다. 이메일만 보고 임의 계정을 자동승격하지 않는다.
4. 이후 새 사용자는 pending이며 승인된 host/admin이 역할·유형·기업 배정을 설정한다. host 지정은 host만 가능하다.

## 미포함

private Storage·문서 업로드·주소/지도/AI·정산은 이번 연결에 포함하지 않는다. 객체 키/권한/파일 제한이 승인되기 전 public bucket을 만들지 않는다.
