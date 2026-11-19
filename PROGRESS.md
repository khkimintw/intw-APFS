# P1 농금원 — 진행 기록 (2026-11-19)

## 완료한 구현

- 경영체 목록에 페이지 크기, 페이지 이동, 검색/상태/포기/재도전/IR 필터, 범위 지정 XLSX 내보내기와 진행 표시를 추가했다.
- 전체 사업자번호, 순번, 24시간 신규 표시, 포기/재도전 뱃지, 특이사항/인트윈 확인사항, 원본 시트 추가 열을 표시한다.
- 상세에서 대표/담당자, 주소 확인/잠금, 등록일시/접수일, IR 일정/확정, 상담 회차 날짜/시간/확정을 관리한다.
- 업로드 파일/작업자/시각/결과를 배치 단위로 기록하고, 중복·오류를 표시한다. 안전 조건을 충족한 미수정·미연결 배치만 되돌릴 수 있다.
- Pseudo User/Admin 전환은 가상 데이터 전용이며 localStorage에만 쓴다. 두 역할은 같은 브라우저의 가상 등록 데이터를 공유하고 실제 Supabase 데이터는 건드리지 않는다.
- 회차 보고서를 PDF/HWP/HWPX/DOC/DOCX/XLS/XLSX로 20MB까지 private Storage에 올리고 서명 다운로드한다. 파일은 브라우저에서 Supabase로 직접 전송해 Vercel Function 요청 한도에 걸리지 않는다.
- README와 API 계약을 현재 기능/제한에 맞게 정리했다.

## 운영 DB에 적용한 additive migration

- 경영체 private 연락처/주소/내부 메모와 시트 payload 영역
- IR 예정/확정과 방문 시간/확정 필드
- 업로드 batch/history/undo RPC
- private report storage bucket, 파일 metadata와 역할/배정 기준 정책

기존 경영체/상담 행은 삭제하거나 재적재하지 않았다. 민감한 원본 값은 Git에 넣지 않았다.

## 검증

- npm run build 성공.
- git diff --check 성공.
- server/apply migration 후 metadata 조회로 보고서 bucket 비공개, 20MB 제한, 3개 storage policy, 5개 metadata column을 확인했다.
- 사용자 역할별 로그인 및 프로덕션 화면 동작은 아직 브라우저에서 확인하지 않았다.

## 남은 작업과 입력 필요

- 암호가 걸린 농금원 Excel을 자동으로 열기와 구형 XLS 지원은 실제 파일 구조에 따라 파서/암호화 방식이 달라 샘플 파일 확인이 필요하다. 현재 암호 없는 XLSX/CSV만 업로드할 수 있다.
- 사업자번호 주소 자동 조회에는 승인된 주소/사업자 데이터 공급자 키가 필요하다.
- 시스템에서 직접 이메일 발송은 연결하지 않았다. 현재는 메일 앱에서 작성하는 링크만 있다.
- 경로 최적화 없이 Google 지도 링크만 제공한다.
- Pseudo 화면의 보고서 파일은 이름/크기만 가상으로 기록하며 파일 바이트를 저장하지 않는다.
- direct Data API 보안 경계, 실제 로그인/CRUD와 배포 동작은 배포 후 확인해야 한다.

## 배포 상태

commit e20e129를 khkimintw/intw-APFS와 intween/intw-APFS main에 push했다. Vercel 배포가 시작되도록 push했으며, 운영 URL이 SSO로 보호되어 새 배포 완료 상태는 이 세션에서 확인하지 못했다.
