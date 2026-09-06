import axios from 'axios';
import AuthAxios from '../lib/axios/AuthAxios';

function resolveReportBaseUrl(): string {
    const configuredBase = String(import.meta.env.VITE_REPORT_BASE_URL || '').trim();
    const localApiHost = String(import.meta.env.VITE_PUBLIC_LOCAL_API_HOST || '').trim();
    const raw = configuredBase || (!import.meta.env.DEV ? localApiHost : '');
    if (!raw) return '/api/report';

    const ensureReportPath = (pathname: string) => {
        const normalized = pathname.replace(/\/+$/, '');
        if (!normalized || normalized === '/') return '/api/report';
        return normalized.endsWith('/api/report') ? normalized : `${normalized.replace(/\/+$/, '')}/api/report`;
    };

    try {
        const url = new URL(raw);
        const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (isLoopback && typeof window !== 'undefined') {
            url.hostname = window.location.hostname;
        }
        url.pathname = ensureReportPath(url.pathname);
        return url.toString().replace(/\/+$/, '');
    } catch {
        const withNoTrailingSlash = raw.replace(/\/+$/, '');
        if (!withNoTrailingSlash) return '/api/report';
        return withNoTrailingSlash.endsWith('/api/report')
            ? withNoTrailingSlash
            : `${withNoTrailingSlash}/api/report`;
    }
}

const reportClient = axios.create({
    baseURL: resolveReportBaseUrl(),
    withCredentials: true,
    timeout: 8000,
    headers: {
        'Content-Type': 'application/json',
    },
});

export type UploadFileResponse = {
    presignedUrl: string;
    requiredHeaders: Record<string, string>;
};

export type PhotoUploadMeta = {
    aiState: boolean;
    /** yyyy-MM-dd */
    dateTaken: string;
    source: string;
    contentType?: string;
    fileSize?: number;
    conditionalWrite?: boolean;
};

export type CreateSnapRequest = {
    title: string;
    description: string;
    source: string;
    tags: string[];
    /** S3 file keys (photo/<id>) */
    photos: string[];
    starIds: string[];
    starGroupIds: string[];
    commentState: boolean;
};

export type UpdateSnapRequest = {
    snapId: string;
    title: string;
    tags: string[];
    starIds: string[];
    starGroupIds: string[];
    commentState: boolean;
};

export type SnapPhoto = {
    fileKey: string;
    contentType?: string | null;
    source?: string | null;
    aiState?: boolean;
    dateTaken?: string | null;
    fileSize?: number | null;
    width?: number | null;
    height?: number | null;
    [key: string]: unknown;
};

export type CreateSnapResponse = {
    title: string;
    tags: string[];
    photos: SnapPhoto[];
    createdAt: string;
    commentState: boolean;
};

export type SnapFeedUser = {
    username: string;
    imageKey?: string | null;
};

export type SnapFeedComment = {
    id?: string;
    commentId?: string;
    comment?: string;
    username?: string;
    content?: string;
    profileKey?: string | null;
    createdAt?: string | null;
    modifiedAt?: string | null;
    [key: string]: unknown;
};

export type SnapFeedItem = {
    createdUser: SnapFeedUser;
    snapData: {
        snapId: string;
        title: string;
        createdAt?: string;
        viewCount?: number;
        tags: string[];
        photos: SnapPhoto[];
        comments: SnapFeedComment[];
        commentState: boolean;
        likeState?: boolean;
        saveState?: boolean;
    };
};

export type GetSnapRequest = {
    size: number;
    page: number;
    tag: string[];
    title: string;
    user: string | null;
    starId: string[];
    starGroupId: string[];
};

type SliceResponse<T> = {
    content: T[];
    empty: boolean;
    first: boolean;
    last: boolean;
    number: number;
    numberOfElements: number;
    size: number;
};

export type SnapSliceResponse = SliceResponse<SnapFeedItem>;

export type ReportStatus = 'RECEIVED' | 'IN_REVIEW' | 'COMPLETED';
export type ReportType = 'SNAP' | 'COMMENT' | 'USER';

export type MyReportHistoryItem = {
    id: string;
    reportType: ReportType;
    reportStatus: ReportStatus;
    explanation: string;
    responseMessage: string | null;
    targetLabel: string;
    createdAt: string;
};

export type InquiryStatus = 'RECEIVED' | 'ANSWERED';

export type InquiryItem = {
    id: string;
    title: string;
    content: string;
    status: InquiryStatus;
    responseMessage: string | null;
    createdAt: string;
};

export type BlockedUserItem = {
    userId: string;
    username: string;
    userImageUrl: string | null;
};

type ReporterDto = {
    username?: string;
    [key: string]: unknown;
};

type SnapReportDtoResponse = {
    id: string;
    createdAt: string;
    reportStatus: ReportStatus;
    responseMessage: string | null;
    explanation: string;
    reporter?: ReporterDto;
    snap?: {
        title?: string;
        [key: string]: unknown;
    };
};

type CommentReportDtoResponse = {
    id: string;
    createdAt: string;
    reportStatus: ReportStatus;
    responseMessage: string | null;
    explanation: string;
    reporter?: ReporterDto;
    comment?: {
        content?: string;
        [key: string]: unknown;
    };
};

type UserReportDtoResponse = {
    id: string;
    createdAt: string;
    reportStatus: ReportStatus;
    responseMessage: string | null;
    explanation: string;
    reporter?: ReporterDto;
    defendant?: {
        username?: string;
        [key: string]: unknown;
    };
};

export type SnapLikeToggleResponse = {
    message: string;
    status: number;
    linkState: 'LINK' | 'UNLINK';
    linked: boolean;
};

export type UserProfileResponse = {
    userId: string;
    username: string;
    email: string;
    profileImageUrl?: string | null;
    authority: string;
    friendCount: number;
    isPrivate: boolean;
};

export type FriendItem = {
    id: string;
    username: string;
    profileImageUrl: string | null;
};

export type ProfileImageUploadResponse = {
    objectUrl?: string;
    fileKey?: string;
    [key: string]: unknown;
};

type StarListItemResponse = {
    id?: string;
    name: string;
    nickname?: string;
    gender?: string;
    birthday?: string;
    explanation?: string | null;
    imageKey?: string | null;
    profileImageUrl?: string | null;
    imageUrl?: string | null;
    createdAt?: string;
    starGroup?: {
        id?: string;
        name?: string;
    } | null;
    [key: string]: unknown;
};

type StarGroupListItemResponse = {
    id: string;
    name: string;
    imageKey?: string | null;
    profileImageUrl?: string | null;
    imageUrl?: string | null;
    debutDate?: string;
    explanation?: string | null;
    starGroupType?: string;
    createdAt?: string;
    [key: string]: unknown;
};

const IMAGE_FIELD_CANDIDATES = [
    'imageKey',
    'profileImageUrl',
    'imageUrl',
    'profileKey',
    'profileImageKey',
    'thumbnailUrl',
    'photoKey',
    'fileKey',
] as const;

const pickImageField = (item: Record<string, unknown>): string | null => {
    for (const key of IMAGE_FIELD_CANDIDATES) {
        const value = item[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    for (const [key, value] of Object.entries(item)) {
        if (!/(image|profile|photo|thumbnail|file)/i.test(key)) continue;
        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return null;
};

export type StarSearchItem = {
    id: string;
    name: string;
    nickname?: string;
    gender?: string;
    birthday?: string;
    explanation?: string | null;
    imageKey?: string | null;
    createdAt?: string;
    starGroup?: {
        id?: string;
        name?: string;
    } | null;
};

export type UserSearchItem = {
    userId: string;
    username: string;
    profileImageUrl?: string | null;
    isPrivate: boolean;
};

export type StarGroupSearchItem = {
    id: string;
    name: string;
    imageKey?: string | null;
    debutDate?: string;
    explanation?: string | null;
    starGroupType?: string;
    createdAt?: string;
};

/** presigned URL 발급 (POST /api/file/photo) */
export async function getPhotoPresignedUrl(meta: PhotoUploadMeta): Promise<UploadFileResponse> {
    const resp = await AuthAxios.post<UploadFileResponse>('file/photo', meta);
    return resp.data;
}

/** presigned URL 경로에서 S3 object key(fileKey) 추출 */
export function extractFileKey(presignedUrl: string): string {
    const { pathname } = new URL(presignedUrl);
    const decoded = decodeURIComponent(pathname);
    const idx = decoded.indexOf('photo/');
    return idx >= 0 ? decoded.slice(idx) : decoded.replace(/^\/+/, '');
}

/** presigned URL로 S3에 직접 업로드 */
export async function uploadToPresignedUrl(
    presignedUrl: string,
    file: File,
    requiredHeaders: Record<string, string>,
): Promise<void> {
    const safeRequiredHeaders = Object.fromEntries(
        Object.entries(requiredHeaders).filter(
            ([name]) =>
                !['authorization', 'cookie', 'proxy-authorization', 'content-length', 'host'].includes(
                    name.toLowerCase(),
                ),
        ),
    )
    await axios.put(presignedUrl, file, {
        headers: {
            'Content-Type': file.type || 'application/octet-stream',
            ...safeRequiredHeaders,
        },
        withCredentials: false,
    });
}

/** 단일 사진 업로드 (presign → S3 PUT) 후 fileKey 반환 */
export async function uploadPhoto(file: File, meta: PhotoUploadMeta): Promise<string> {
    const contentType = file.type.split(';', 1)[0].trim().toLowerCase();
    const supportedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (!supportedTypes.has(contentType) || file.size <= 0 || file.size > 15 * 1024 * 1024) {
        throw new Error('JPG, PNG, WebP 형식의 15 MiB 이하 사진만 업로드할 수 있습니다.');
    }
    const { presignedUrl, requiredHeaders } = await getPhotoPresignedUrl({
        ...meta,
        contentType,
        fileSize: file.size,
        conditionalWrite: true,
    });
    await uploadToPresignedUrl(presignedUrl, file, requiredHeaders);
    return extractFileKey(presignedUrl);
}

/** 스냅 생성 (POST /api/snap/create, multipart @RequestPart snapDto) */
export async function createSnap(request: CreateSnapRequest): Promise<CreateSnapResponse> {
    const formData = new FormData();
    formData.append('snapDto', new Blob([JSON.stringify(request)], { type: 'application/json' }));

    const resp = await AuthAxios.post<CreateSnapResponse>('snap/create', formData);
    return resp.data;
}

/** 스냅 수정 (PATCH /api/snap/update, multipart/form-data @ModelAttribute) */
export async function updateSnap(request: UpdateSnapRequest): Promise<SnapFeedItem> {
    const formData = new FormData();
    formData.append('snapId', request.snapId);
    formData.append('title', request.title);
    request.tags.forEach((tag) => formData.append('tags', tag));
    // Spring field markers distinguish clearing a relation from an omitted update.
    formData.append('_starIds', 'on');
    formData.append('_starGroupIds', 'on');
    request.starIds.forEach((id) => formData.append('starIds', id));
    request.starGroupIds.forEach((id) => formData.append('starGroupIds', id));
    formData.append('commentState', String(request.commentState));

    const resp = await AuthAxios.patch<SnapFeedItem>('snap/update', formData);
    return resp.data;
}

/** 메인 스냅 조회 (GET /api/snap) */
export async function getSnaps(request: GetSnapRequest): Promise<SnapSliceResponse> {
    const resp = await AuthAxios.get<SnapSliceResponse>('snap', {
        params: request,
        paramsSerializer: { indexes: null },
    });

    return resp.data;
}

/** 스타그룹 연결 스냅 조회 (GET /api/snap/star-group?star-group-id=&page=&size=) */
export async function getSnapsByStarGroup(starGroupId: string, page = 0, size = 100): Promise<SnapSliceResponse> {
    const resp = await AuthAxios.get<SnapSliceResponse>('snap/star-group', {
        params: {
            'star-group-id': starGroupId,
            page,
            size,
        },
    });

    return resp.data;
}

/** 메인 피드 조회 (GET /api/snap/feed?page=&size=) */
export async function getFeedSnaps(page = 0, size = 24): Promise<SnapSliceResponse> {
    const resp = await AuthAxios.get<SnapSliceResponse>('snap/feed', {
        params: {
            page,
            size,
        },
    });

    return resp.data;
}

/** 얼굴 벡터 유사도 기반 연관 스냅 조회 (GET /api/snap/{snapId}/related) */
export async function getRelatedSnaps(snapId: string, page = 0, size = 12): Promise<SnapSliceResponse> {
    const resp = await AuthAxios.get<SnapSliceResponse>(`snap/${encodeURIComponent(snapId)}/related`, {
        params: {
            page,
            size,
        },
    });

    return resp.data;
}

/** 현재 로그인 사용자 조회 (GET /api/user/get) */
export async function getMyProfile(): Promise<UserProfileResponse> {
    const resp = await AuthAxios.get<UserProfileResponse>('user/get');
    return resp.data;
}

/** 사용자명으로 사용자 조회 (GET /api/user/by-username?username=) */
export async function getUserProfileByUsername(username: string): Promise<UserProfileResponse> {
    const resp = await AuthAxios.get<UserProfileResponse>('user/by-username', {
        params: { username },
    });
    return resp.data;
}

/** 프로필 이미지 변경 (PATCH /api/user/update/profile-image) */
export async function changeProfileImage(file: File): Promise<ProfileImageUploadResponse> {
    const resp = await AuthAxios.patch<ProfileImageUploadResponse>('user/update/profile-image', file, {
        headers: {
            'Content-Type': file.type || 'application/octet-stream',
        },
    });
    return resp.data;
}

/** 사용자명 변경 (PATCH /api/user/update/username?username=) */
export async function changeUsername(username: string): Promise<UserProfileResponse> {
    const resp = await AuthAxios.patch<UserProfileResponse>('user/update/username', null, {
        params: { username },
    });
    return resp.data;
}

/** 비공개 계정 설정 변경 (PATCH /api/user/update/privacy?is-private=) */
export async function changeAccountPrivacy(isPrivate: boolean): Promise<UserProfileResponse> {
    const resp = await AuthAxios.patch<UserProfileResponse>('user/update/privacy', null, {
        params: { 'is-private': isPrivate },
    });
    return resp.data;
}

/** 내 스냅 조회 (GET /api/snap/my?page=&size=) */
export async function getMySnaps(page = 0, size = 100): Promise<SnapFeedItem[]> {
    const resp = await AuthAxios.get<SnapSliceResponse>('snap/my', {
        params: {
            page,
            size,
        },
    });

    return resp.data.content;
}

/** 저장된 스냅 조회 (GET /api/snap/saved) */
export async function getSavedSnaps(): Promise<SnapFeedItem[]> {
    const resp = await AuthAxios.get<SnapFeedItem[]>('snap/saved');
    return resp.data;
}

/** 친구 요청 보내기 (POST /api/user/friend/request?user-id=) */
export async function sendFriendRequest(userId: string): Promise<void> {
    await AuthAxios.post('user/friend/request', null, {
        params: {
            'user-id': userId,
        },
    });
}

/** 내가 보낸 친구 요청 취소 (DELETE /api/user/friend/request?user-id=) */
export async function cancelFriendRequest(userId: string): Promise<void> {
    await AuthAxios.delete('user/friend/request', {
        params: {
            'user-id': userId,
        },
    });
}

/** 내가 받은 친구 요청 수락 (POST /api/user/friend/accept?user-id=) */
export async function acceptFriendRequest(userId: string): Promise<void> {
    await AuthAxios.post('user/friend/accept', null, {
        params: {
            'user-id': userId,
        },
    });
}

/** 내가 받은 친구 요청 거절 (DELETE /api/user/friend/reject?user-id=) */
export async function rejectFriendRequest(userId: string): Promise<void> {
    await AuthAxios.delete('user/friend/reject', {
        params: {
            'user-id': userId,
        },
    });
}

/** 친구 관계 해제 (DELETE /api/user/friend?user-id=) */
export async function unfriend(userId: string): Promise<void> {
    await AuthAxios.delete('user/friend', {
        params: {
            'user-id': userId,
        },
    });
}

/** 내 친구 목록 조회 (GET /api/user/friend?page=&size=) */
export async function getMyFriends(page = 0, size = 200): Promise<FriendItem[]> {
    const resp = await AuthAxios.get<SliceResponse<FriendItem>>('user/friend', {
        params: {
            page,
            size,
        },
    });
    return resp.data?.content ?? [];
}

/** 내가 받은 대기중 친구 요청 목록 조회 (GET /api/user/friend/received?page=&size=) */
export async function getReceivedFriendRequests(page = 0, size = 200): Promise<FriendItem[]> {
    const resp = await AuthAxios.get<SliceResponse<FriendItem>>('user/friend/received', {
        params: {
            page,
            size,
        },
    });
    return resp.data?.content ?? [];
}

/** 내가 보낸 대기중 친구 요청 목록 조회 (GET /api/user/friend/sent?page=&size=) */
export async function getSentFriendRequests(page = 0, size = 200): Promise<FriendItem[]> {
    const resp = await AuthAxios.get<SliceResponse<FriendItem>>('user/friend/sent', {
        params: {
            page,
            size,
        },
    });
    return resp.data?.content ?? [];
}

/** 전체 스냅 조회 (/feed 페이지를 순회해 병합) */
export async function getAllSnaps(pageSize = 100): Promise<SnapFeedItem[]> {
    const merged: SnapFeedItem[] = [];
    let page = 0;

    while (true) {
        const resp = await getFeedSnaps(page, pageSize);
        merged.push(...resp.content);

        if (resp.last || resp.empty || resp.content.length === 0) {
            break;
        }

        page += 1;
    }

    return merged;
}

/** 스냅 단건 조회 (/feed 페이지를 순회하며 snapId 매칭) */
export async function getSnapById(snapId: string, pageSize = 100): Promise<SnapFeedItem | null> {
    let page = 0;

    while (true) {
        const resp = await getFeedSnaps(page, pageSize);
        const found = resp.content.find((snap) => snap.snapData?.snapId === snapId);
        if (found) return found;

        if (resp.last || resp.empty || resp.content.length === 0) {
            return null;
        }

        page += 1;
    }
}

/** 스냅 상세 진입 조회수 증가 (POST /api/snap/view?snap-id=) */
export async function increaseSnapView(snapId: string): Promise<void> {
    await AuthAxios.post('snap/view', null, {
        params: {
            'snap-id': snapId,
        },
    });
}

/** 스타 검색 (GET /api/star?page=&size=&star-name=) */
export async function searchStars(keyword: string, page = 0, size = 20): Promise<StarSearchItem[]> {
    const resp = await AuthAxios.get<SliceResponse<StarListItemResponse>>('star', {
        params: {
            page,
            size,
            'star-name': keyword,
        },
    });

    return resp.data.content.map((item) => ({
        id: item.id ?? '',
        name: item.name,
        nickname: item.nickname,
        gender: item.gender,
        birthday: item.birthday,
        explanation: item.explanation,
        imageKey: pickImageField(item),
        createdAt: item.createdAt,
        starGroup: item.starGroup,
    }));
}

export function toStarRouteKey(star: Pick<StarSearchItem, 'name' | 'nickname'>): string {
    return encodeURIComponent(`${star.name}::${star.nickname ?? ''}`);
}

export function fromStarRouteKey(starKey: string): { name: string; nickname?: string } {
    const decoded = decodeURIComponent(starKey);
    const [name = '', nickname = ''] = decoded.split('::');
    return {
        name,
        nickname: nickname || undefined,
    };
}

/** 유저 검색 (GET /api/user?page=&size=&username=) */
export async function searchUsers(keyword: string, page = 0, size = 20): Promise<UserSearchItem[]> {
    const resp = await AuthAxios.get<SliceResponse<UserSearchItem>>('user', {
        params: {
            page,
            size,
            username: keyword,
        },
    });

    return resp.data.content;
}

/** 스타그룹 검색 (GET /api/star-group?page=&size=&star-group-name=) */
export async function searchStarGroups(keyword: string, page = 0, size = 20): Promise<StarGroupSearchItem[]> {
    const resp = await AuthAxios.get<SliceResponse<StarGroupListItemResponse>>('star-group', {
        params: {
            page,
            size,
            'star-group-name': keyword,
        },
    });

    return resp.data.content.map((item) => ({
        id: item.id,
        name: item.name,
        imageKey: pickImageField(item),
        debutDate: item.debutDate,
        explanation: item.explanation,
        starGroupType: item.starGroupType,
        createdAt: item.createdAt,
    }));
}

/** 스타 팬 등록 (POST /api/fan/join?star-id=) */
export async function joinFan(starId: string): Promise<void> {
    await AuthAxios.post('fan/join', null, {
        params: { 'star-id': starId },
    });
}

/** 스타 팬 등록 해제 (POST /api/fan/disconnect?star-id=) */
export async function disconnectFan(starId: string): Promise<void> {
    await AuthAxios.post('fan/disconnect', null, {
        params: { 'star-id': starId },
    });
}

/** 스타 팬 상태 조회 (GET /api/fan/state?star-id=) */
export async function getFanState(starId: string): Promise<boolean> {
    const resp = await AuthAxios.get<{ joined: boolean }>('fan/state', {
        params: { 'star-id': starId },
    });
    return !!resp.data?.joined;
}

/** 인기 검색어 조회 (GET /api/star/popular-search-keywords?size=) */
export async function getPopularSearchKeywords(size = 8): Promise<string[]> {
    const resp = await AuthAxios.get<string[]>('star/popular-search-keywords', {
        params: { size },
    });
    return resp.data;
}

/** 스냅 좋아요 토글 */
export async function likeSnap(snapId: string): Promise<SnapLikeToggleResponse> {
    const resp = await AuthAxios.post<SnapLikeToggleResponse>('snap/like', null, {
        params: { 'snap-id': snapId },
    });
    return resp.data;
}

/**
 * 스냅 좋아요 취소 (호환용)
 * 서버가 토글 API로 통합되어 내부적으로 동일 엔드포인트를 호출한다.
 */
export async function unlikeSnap(snapId: string): Promise<void> {
    await likeSnap(snapId);
}

/** 스냅 저장 */
export async function saveSnap(snapId: string): Promise<void> {
    await AuthAxios.post('snap/save', null, { params: { 'snap-id': snapId } });
}

/** 스냅 저장 취소 */
export async function unsaveSnap(snapId: string): Promise<void> {
    await AuthAxios.delete('snap/un-save', { params: { 'snap-id': snapId } });
}

/** 스냅 삭제 */
export async function deleteSnap(snapId: string): Promise<void> {
    await AuthAxios.patch('snap/delete', null, { params: { 'snap-id': snapId } });
}

/** 스냅 신고 */
export async function reportSnap(snapId: string, explanation: string): Promise<void> {
    await AuthAxios.post('report/snap', {
        snapId,
        explanation,
    });
}

/** 댓글 삭제 (소프트 삭제) */
export async function deleteComment(commentId: string): Promise<void> {
    await AuthAxios.patch('snap/comment/delete', null, { params: { 'comment-id': commentId } });
}

/** 댓글 신고 */
export async function reportComment(commentId: string, explanation: string): Promise<void> {
    await AuthAxios.post('report/comment', {
        commentId,
        explanation,
    });
}

/** 유저 신고 */
export async function reportUser(userId: string, explanation: string): Promise<void> {
    await AuthAxios.post('report/user', {
        userId,
        explanation,
    });
}

/** 내가 신고한 내역 조회 (GET /api/report/{snap|comment|user}?page=&size=) */
export async function getMyReportHistory(sizePerType = 10): Promise<MyReportHistoryItem[]> {
    const params = { page: 0, size: sizePerType };

    const [snapResp, commentResp, userResp] = await Promise.allSettled([
        reportClient.get<SliceResponse<SnapReportDtoResponse>>('/snap', { params }),
        reportClient.get<SliceResponse<CommentReportDtoResponse>>('/comment', { params }),
        reportClient.get<SliceResponse<UserReportDtoResponse>>('/user', { params }),
    ]);

    const snapContent = snapResp.status === 'fulfilled' ? snapResp.value.data?.content ?? [] : [];
    const commentContent = commentResp.status === 'fulfilled' ? commentResp.value.data?.content ?? [] : [];
    const userContent = userResp.status === 'fulfilled' ? userResp.value.data?.content ?? [] : [];

    const snapItems: MyReportHistoryItem[] = snapContent.map((item) => ({
        id: item.id,
        reportType: 'SNAP',
        reportStatus: item.reportStatus,
        explanation: item.explanation,
        responseMessage: item.responseMessage,
        targetLabel: item.snap?.title?.trim() || '스냅',
        createdAt: item.createdAt,
    }));

    const commentItems: MyReportHistoryItem[] = commentContent.map((item) => ({
        id: item.id,
        reportType: 'COMMENT',
        reportStatus: item.reportStatus,
        explanation: item.explanation,
        responseMessage: item.responseMessage,
        targetLabel: item.comment?.content?.trim() || '댓글',
        createdAt: item.createdAt,
    }));

    const userItems: MyReportHistoryItem[] = userContent.map((item) => ({
        id: item.id,
        reportType: 'USER',
        reportStatus: item.reportStatus,
        explanation: item.explanation,
        responseMessage: item.responseMessage,
        targetLabel: item.defendant?.username?.trim() || '유저',
        createdAt: item.createdAt,
    }));

    return [...snapItems, ...commentItems, ...userItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

/** 문의 등록 (POST /api/inquiry) */
export async function createInquiry(title: string, content: string): Promise<void> {
    await AuthAxios.post('inquiry', {
        title,
        content,
    });
}

/** 내 문의 내역 조회 (GET /api/inquiry/my?page=&size=) */
export async function getMyInquiries(page = 0, size = 20): Promise<InquiryItem[]> {
    const resp = await AuthAxios.get<SliceResponse<InquiryItem>>('inquiry/my', {
        params: {
            page,
            size,
        },
    });

    return resp.data?.content ?? [];
}

/** 차단 사용자 목록 조회 (GET /api/black-user?page=&size=) */
export async function getBlockedUsers(page = 0, size = 50): Promise<BlockedUserItem[]> {
    const resp = await AuthAxios.get<SliceResponse<BlockedUserItem>>('black-user', {
        params: {
            page,
            size,
        },
    });

    return resp.data?.content ?? [];
}

/** 차단 사용자 해제 (DELETE /api/unblack-user?unblack-user-id=) */
export async function unBlockUser(userId: string): Promise<void> {
    await AuthAxios.delete('unblack-user', {
        params: {
            'unblack-user-id': userId,
        },
    });
}

/** 댓글 작성 (POST /api/snap/comment/create) */
export async function createComment(snapId: string, content: string): Promise<SnapFeedComment> {
    const resp = await AuthAxios.post<SnapFeedComment>('snap/comment/create', { content, snapId });
    return resp.data;
}

/** 인기 태그 조회 (GET /api/tag/trending?size=) */
export async function getTrendingTags(size = 8): Promise<string[]> {
    const resp = await AuthAxios.get<string[]>('tag/trending', {
        params: { size },
    });
    return resp.data;
}
