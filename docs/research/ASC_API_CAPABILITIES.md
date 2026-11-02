# App Store Connect API capabilities used by Studio
Source: Apple OpenAPI specification v4.5.1 (downloaded 2026-11-02, kept out of the repository). Status words: VERIFIED = matches the spec; NOT_VERIFIED = never called against a real account.

| Call | Path | Spec check | Real account |
|---|---|---|---|
| Connection test | `GET /v1/apps?limit=1` | VERIFIED (path exists) | NOT_VERIFIED |
| Find app | `GET /v1/apps?filter[bundleId]=` | VERIFIED | NOT_VERIFIED |
| Bundle ids | `GET/POST /v1/bundleIds` (`platform: IOS`) | VERIFIED (attributes `name`, `platform`, `identifier`) | NOT_VERIFIED |
| Certificates | `POST /v1/certificates` (`csrContent`, `certificateType: IOS_DISTRIBUTION`) | VERIFIED | NOT_VERIFIED |
| Profiles | `GET/POST /v1/profiles` (`profileType: IOS_APP_STORE`, relationships `bundleId`, `certificates`) | VERIFIED | NOT_VERIFIED |
| Build upload | `POST /v1/buildUploads` (`cfBundleShortVersionString`, `cfBundleVersion`, `platform`, relationship `app`) | VERIFIED | NOT_VERIFIED |
| Upload file | `POST /v1/buildUploadFiles` (`fileName`, `fileSize`, `uti: com.apple.ipa`, `assetType: ASSET`) → `uploadOperations[{method,url,length,offset,requestHeaders}]` | VERIFIED | NOT_VERIFIED |
| Commit | `PATCH /v1/buildUploadFiles/{id}` (`uploaded: true`, `sourceFileChecksums`) | VERIFIED | NOT_VERIFIED |
| Status | `GET /v1/buildUploads/{id}` (`state.state`: COMPLETE / FAILED / PROCESSING …) | VERIFIED for field names; exhaustive state enum not enumerated | NOT_VERIFIED |

Not possible through the API: creating the app record itself (App Store Connect web UI). Studio reports this instead of failing obscurely. Studio never calls revoke/delete endpoints.
