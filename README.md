# 경계선

중학교 2학년 학생이 전 세계 지진·화산 분포를 관찰하고 판 경계를 직접 그려 제출하는 45분 수업용 웹앱입니다. 교사 대시보드에서는 여섯 모둠의 선을 실시간으로 겹쳐 보고, 실제 판 경계와 비교한 뒤 일본·한반도 적용 활동을 진행할 수 있습니다.

## 구성

- 학생: 수업 코드와 모둠 번호로 참여, 경계선 그리기, 1차 제출, 원리 학습, 수정 제출
- 교사: 수업 생성, 제출 현황, 모둠 선 중첩, 실제 경계 공개, 동아시아 단계 제어
- 데이터: USGS 지진·판 경계, Smithsonian GVP 홀로세 화산의 고정 스냅샷
- 지도 엔진: Leaflet과 Natural Earth 110m 해안선을 앱 내부에 포함
- 백엔드: Firebase Authentication 익명 인증 + Cloud Firestore
- 배포: Firebase Hosting

Firebase 설정이 비어 있으면 같은 브라우저의 탭 사이에서 시험할 수 있는 `로컬 시연 모드`로 작동합니다.

## 로컬 실행

정적 파일을 HTTP 서버로 열어야 ES 모듈과 데이터 파일이 정상 동작합니다.

```powershell
npm.cmd run serve
```

표시된 주소에서 `/teacher.html`을 열어 수업 코드를 만든 뒤, 학생 입장 주소를 새 탭에서 엽니다.

## 데이터 스냅샷 만들기

```powershell
node scripts/fetch-data.mjs
```

종료일을 고정하려면 다음처럼 실행합니다.

```powershell
node scripts/fetch-data.mjs 2026-09-02
```

전 세계 지진은 2000년 이후 규모 5.0 이상 자료를 2도 격자별로 시간 층화해 화면용으로 줄입니다. 한반도 상세 레이어는 현재 공개 키 없이 생성 가능한 USGS 규모 2.5 이상 지역 자료입니다. 기상청 또는 KIGAM API 키를 준비하면 검토한 국내 지진 스냅샷으로 교체하세요. 앱의 범례는 공통 자료와 상세 자료의 개수를 직접 비교하지 않도록 안내합니다.

## Firebase 연결

1. Firebase 프로젝트와 Web App을 만듭니다.
2. Authentication에서 익명 로그인을 활성화합니다.
3. Firestore Database를 생성합니다.
4. Firebase Console의 SDK 설정을 [public/firebase-config.js](public/firebase-config.js)에 입력합니다.
5. `.firebaserc.example`을 `.firebaserc`로 복사하고 프로젝트 ID를 입력합니다.
6. 보안 규칙과 Hosting을 배포합니다.

```powershell
firebase deploy --only firestore:rules,hosting
```

교사는 수업을 생성한 브라우저의 익명 UID로 수업 제어 권한을 갖습니다. 학생은 별도의 회원가입이나 실명 입력 없이 익명 인증을 사용합니다.

## 점검

```powershell
node scripts/check.mjs
```

로컬 서버가 실행 중일 때 Chrome 기반 브라우저 흐름도 점검할 수 있습니다.

```powershell
node scripts/browser-smoke.mjs
```

Firebase 설정 후에도 로컬 시연 모드를 확인하려면 로컬 주소에 `?backend=local`을 붙입니다. 이 옵션은 `localhost`와 `127.0.0.1`에서만 작동합니다.

수업 운영 및 기능 명세는 [판_경계_추론_수업_계획.md](판_경계_추론_수업_계획.md)를 참고하세요.
