import { Readable } from "stream";
import { google } from "googleapis";

// 기존에 팀에서 쓰던 공유 프레젠테이션 파일. 앱스크립트 v15의 SHARED_PRESENTATION_ID와 동일하다.
const DEFAULT_PRESENTATION_ID = "1DP9aoI2Pr2S7XfLZsPboCFBazvqzhKacmU-iYqA7LTg";
const NOTES_MARKER_PREFIX = "SLIDE_KEY:";

export function getSlidesPresentationId() {
  return process.env.GOOGLE_SLIDES_PRESENTATION_ID || DEFAULT_PRESENTATION_ID;
}

// Firestore/Auth 검증에 쓰는 것과 같은 서비스 계정을 재사용한다 (Slides/Drive API 접근 권한만 추가로 필요).
function getGoogleAuth() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) return null;

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

type PublishParams = {
  slideKey: string;
  projectName: string;
  imageDataUrl: string; // data:image/png;base64,....
};

export async function publishCompositeToSlides({
  slideKey,
  projectName,
  imageDataUrl,
}: PublishParams): Promise<{ presentationUrl: string }> {
  const auth = getGoogleAuth();
  if (!auth) {
    throw new Error(
      "Google 서비스 계정 키(FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY)가 설정되지 않았습니다.",
    );
  }

  const drive = google.drive({ version: "v3", auth });
  const slides = google.slides({ version: "v1", auth });
  const presentationId = getSlidesPresentationId();

  // 서비스 계정 자체는 드라이브 저장용량이 없으므로 (Google 정책), 공유 드라이브를 찾아서 그 안에 올린다.
  // 서비스 계정이 "콘텐츠 관리자" 이상으로 추가된 공유 드라이브가 하나 있어야 한다.
  const sharedDrives = await drive.drives.list({ pageSize: 1 });
  const sharedDriveId = sharedDrives.data.drives?.[0]?.id;
  if (!sharedDriveId) {
    throw new Error(
      "서비스 계정이 속한 공유 드라이브(Shared Drive)를 찾을 수 없습니다. " +
        "구글 드라이브에서 공유 드라이브를 만들고 서비스 계정을 콘텐츠 관리자로 추가해주세요.",
    );
  }

  // 1) 합성 이미지를 드라이브에 올린다. Slides API는 이미지를 URL로만 가져올 수 있어서
  //    (바이트를 직접 전송하는 방법이 없다) 링크가 있으면 볼 수 있게 공개 설정을 해준다.
  const base64 = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;
  const buffer = Buffer.from(base64, "base64");
  const uploaded = await drive.files.create({
    requestBody: { name: `${projectName}_${slideKey}.png`, parents: [sharedDriveId] },
    media: { mimeType: "image/png", body: Readable.from(buffer) },
    fields: "id",
    supportsAllDrives: true,
  });
  const fileId = uploaded.data.id;
  if (!fileId) throw new Error("이미지를 구글 드라이브에 업로드하지 못했습니다.");
  await drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    requestBody: { role: "reader", type: "anyone" },
  });
  const imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

  // 2) 프레젠테이션 페이지 크기 + 기존 슬라이드 목록 확인
  const presentation = await slides.presentations.get({ presentationId });
  const pageSize = presentation.data.pageSize;
  if (!pageSize?.width?.magnitude || !pageSize?.height?.magnitude) {
    throw new Error("프레젠테이션 페이지 크기를 확인하지 못했습니다.");
  }
  const size = {
    width: { magnitude: pageSize.width.magnitude, unit: pageSize.width.unit ?? "EMU" },
    height: { magnitude: pageSize.height.magnitude, unit: pageSize.height.unit ?? "EMU" },
  };

  // 같은 매장 + 같은 탭(책상/PC)으로 이미 등록된 슬라이드가 있으면 스피커 노트에 적어둔
  // "SLIDE_KEY:xxx" 마커로 찾아낸다 (앱스크립트 v11 이후와 동일한 방식).
  const marker = `${NOTES_MARKER_PREFIX}${slideKey}`;
  const existingSlide = (presentation.data.slides ?? []).find((slide) => {
    const notesPage = slide.slideProperties?.notesPage;
    const speakerNotesId = notesPage?.notesProperties?.speakerNotesObjectId;
    if (!speakerNotesId) return false;
    const notesShape = notesPage.pageElements?.find((el) => el.objectId === speakerNotesId);
    const text =
      notesShape?.shape?.text?.textElements?.map((t) => t.textRun?.content ?? "").join("") ?? "";
    return text.includes(marker);
  });

  if (existingSlide?.objectId) {
    // 기존 슬라이드: 도형을 전부 지우고 새 이미지로 교체한 뒤, 맨 앞으로 이동
    const slideId = existingSlide.objectId;
    const deleteRequests = (existingSlide.pageElements ?? [])
      .filter((el) => el.objectId)
      .map((el) => ({ deleteObject: { objectId: el.objectId! } }));

    await slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [
          ...deleteRequests,
          { updateSlidesPosition: { slideObjectIds: [slideId], insertionIndex: 0 } },
          {
            createImage: {
              url: imageUrl,
              elementProperties: {
                pageObjectId: slideId,
                size,
                transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "EMU" },
              },
            },
          },
        ],
      },
    });
  } else {
    // 새 슬라이드: 맨 앞에 만들고, 이미지 삽입 + 스피커 노트에 마커 기록
    const newSlideId = `slide_${Date.now()}`;
    await slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [
          {
            createSlide: {
              objectId: newSlideId,
              insertionIndex: 0,
              slideLayoutReference: { predefinedLayout: "BLANK" },
            },
          },
          {
            createImage: {
              url: imageUrl,
              elementProperties: {
                pageObjectId: newSlideId,
                size,
                transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "EMU" },
              },
            },
          },
        ],
      },
    });

    // 새로 만든 슬라이드의 스피커 노트 도형 ID는 서버가 자동으로 부여하므로 다시 조회해서 찾는다.
    const refreshed = await slides.presentations.get({ presentationId });
    const createdSlide = (refreshed.data.slides ?? []).find((s) => s.objectId === newSlideId);
    const speakerNotesId =
      createdSlide?.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;

    if (speakerNotesId) {
      await slides.presentations.batchUpdate({
        presentationId,
        requestBody: {
          requests: [{ insertText: { objectId: speakerNotesId, text: marker, insertionIndex: 0 } }],
        },
      });
    }
  }

  return { presentationUrl: `https://docs.google.com/presentation/d/${presentationId}/edit` };
}
