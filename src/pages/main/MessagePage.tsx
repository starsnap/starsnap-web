import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { ChevronLeftIcon, SearchIcon, SendIcon } from '../../components/icons'
import {
    ChatFriendListSkeleton,
    ChatMessageListSkeleton,
    ChatRoomListSkeleton,
} from '../../components/ui/ChatSkeletons'
import { FiEdit2, FiLogOut, FiMoreVertical, FiPlus, FiTrash2, FiUserPlus } from 'react-icons/fi'
import {
    getMyFriends,
    getMyProfile,
    getUserProfileByUsername,
    type FriendItem,
    type UserProfileResponse,
} from '../../services/snapService'
import { applyNextImageCandidate, getImageCandidates } from '../../utils/s3Image'
import { useAccessibleDialog } from '../../hooks/useAccessibleDialog'
import { loadChatHistory, mergeChatHistory, type ChatMessageChange } from '../../services/chat/chatHistory'
import {
    addChatRoomMembers,
    createChatRoom,
    createChatWebSocket,
    deleteChatMessage,
    getChatHistory,
    getChatRooms,
    isChatMessageRateLimitedFrame,
    isChatTypingFrame,
    isChatMessageDeletedFrame,
    isChatMessageUpdatedFrame,
    leaveChatRoom,
    sendChatTyping,
    updateChatMessage,
    type ChatMessage,
    type ChatRoomLastMessage,
    type ChatRoomSummary,
} from '../../services/chat/chatService'

type MessageContextMenu = {
    message: ChatMessage
    x: number
    y: number
    trigger: HTMLElement | null
}

type RoomContextMenu = {
    room: ChatRoomSummary
    x: number
    y: number
}

const MIN_ROOM_LIST_WIDTH = 240
const MAX_ROOM_LIST_WIDTH = 520
const MIN_CONVERSATION_WIDTH = 400
const MESSAGE_RATE_WINDOW_MS = 10_000
const MESSAGE_RATE_WINDOW_LIMIT = 5
const MESSAGE_RATE_LIMIT_SECONDS = 30
const DEFAULT_MESSAGE_RATE_LIMIT_MESSAGE = '메시지를 너무 빠르게 보내고 있어요.'

type PendingSendDraft = {
    roomId: string
    content: string
}

type MessagePageProps = {
    standalone?: boolean
}

const parseUtcDateTime = (iso: string) => {
    const value = iso.trim()
    if (!value) return null

    // The server stores UTC as LocalDateTime, so its JSON value may not include a zone suffix.
    const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    const date = new Date(hasTimeZone ? value : `${value}Z`)
    return Number.isNaN(date.getTime()) ? null : date
}

const formatRelative = (iso: string) => {
    const date = parseUtcDateTime(iso)
    if (!date) return ''
    const now = Date.now()
    const diffMin = Math.floor((now - date.getTime()) / 60000)
    if (diffMin < 1) return '방금'
    if (diffMin < 60) return `${diffMin}분`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour}시간`
    const diffDay = Math.floor(diffHour / 24)
    if (diffDay < 7) return `${diffDay}일`
    return date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
}

const formatMessageTime = (iso: string) => {
    const date = parseUtcDateTime(iso)
    if (!date) return ''
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

type ChatAvatarProps = {
    imageKey: string | null | undefined
    alt: string
    className: string
}

const ChatAvatar: React.FC<ChatAvatarProps> = ({ imageKey, alt, className }) => {
    const imageCandidates = getImageCandidates(imageKey)

    return (
        <span className={`overflow-hidden rounded-full bg-placeholder ${className}`}>
            {imageCandidates.length > 0 && (
                <img
                    src={imageCandidates[0]}
                    alt={alt}
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    onError={(event) => {
                        const image = event.currentTarget
                        const previousSrc = image.src
                        applyNextImageCandidate(image, imageCandidates)
                        if (image.src === previousSrc) image.style.display = 'none'
                    }}
                />
            )}
        </span>
    )
}

const getRoomDisplayName = (room: ChatRoomSummary, myUserId?: string) => {
    if (room.title) return room.title
    const otherMembers = room.members.filter((member) => member.userId !== myUserId)
    return otherMembers.map((member) => member.username).join(', ') || '대화'
}

const getRoomAvatarMember = (room: ChatRoomSummary, myUserId?: string) => {
    return room.members.find((member) => member.userId !== myUserId) ?? room.members[0]
}

const isDirectRoomWithUser = (room: ChatRoomSummary, myUserId: string, userId: string) => {
    return room.members.length === 2 &&
        room.members.some((member) => member.userId === myUserId) &&
        room.members.some((member) => member.userId === userId)
}

const messageDisplayText = (message: ChatMessage) =>
    message.status === 'DELETED' ? '삭제된 메시지' : message.content

const roomPreviewText = (lastMessage: ChatRoomLastMessage | null) => {
    if (!lastMessage) return ''
    if (lastMessage.status === 'DELETED') return '삭제된 메시지'
    return lastMessage.content
}

const parseInviteUsernames = (input: string) => input
    .split(',')
    .map((username) => username.trim())
    .filter(Boolean)

type ApiErrorBody = {
    status?: number
    message?: string
}

const resolveChatRoomErrorMessage = (error: unknown) => {
    const axiosError = error as AxiosError<ApiErrorBody> | undefined
    const status = axiosError?.response?.status
    const message = axiosError?.response?.data?.message

    if (status === 400 && typeof message === 'string') {
        if (message.includes('a chat room needs at least two members')) {
            return '최소 1명의 다른 사용자를 초대해야 대화방을 만들 수 있어요.'
        }
        if (message.includes('only friends can be invited')) {
            return '친구인 사용자만 대화방에 초대할 수 있어요.'
        }
        if (message.includes('member not found')) {
            return '존재하지 않는 사용자가 포함되어 있어요. 사용자명을 다시 확인해주세요.'
        }
        return message
    }

    return null
}

const MessagePage: React.FC<MessagePageProps> = ({ standalone = false }) => {
    const [searchParams, setSearchParams] = useSearchParams()
    const targetUsername = (searchParams.get('user') || '').trim()
    const [keyword, setKeyword] = useState('')
    const [selectedRoom, setSelectedRoom] = useState<ChatRoomSummary | null>(null)
    const [messages, setMessagesState] = useState<ChatMessage[]>([])
    const messagesRef = useRef<ChatMessage[]>([])
    const setMessages = (next: React.SetStateAction<ChatMessage[]>) => {
        messagesRef.current = typeof next === 'function' ? next(messagesRef.current) : next
        setMessagesState(messagesRef.current)
    }
    const [input, setInput] = useState('')
    const [chatError, setChatError] = useState<string | null>(null)
    const [rateLimitDeadline, setRateLimitDeadline] = useState(0)
    const [rateLimitRemainingSeconds, setRateLimitRemainingSeconds] = useState(0)
    const [rateLimitMessage, setRateLimitMessage] = useState(DEFAULT_MESSAGE_RATE_LIMIT_MESSAGE)
    const [rateLimitAnnouncement, setRateLimitAnnouncement] = useState('')
    const [messageAnnouncement, setMessageAnnouncement] = useState('')
    const [typingUsers, setTypingUsers] = useState<Record<string, true>>({})
    const [contextMenu, setContextMenu] = useState<MessageContextMenu | null>(null)
    const [roomContextMenu, setRoomContextMenu] = useState<RoomContextMenu | null>(null)
    const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null)
    const [editText, setEditText] = useState('')
    const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null)
    const [messageActionLoading, setMessageActionLoading] = useState(false)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [olderMessagesLoading, setOlderMessagesLoading] = useState(false)
    const [directRoomCreating, setDirectRoomCreating] = useState(false)
    const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false)
    const [newRoomTitle, setNewRoomTitle] = useState('')
    const [newRoomMemberNames, setNewRoomMemberNames] = useState('')
    const [isCreatingRoom, setIsCreatingRoom] = useState(false)
    const [isAddMemberOpen, setIsAddMemberOpen] = useState(false)
    const [addMemberNames, setAddMemberNames] = useState('')
    const [isAddingMember, setIsAddingMember] = useState(false)
    const [leaveRoomTarget, setLeaveRoomTarget] = useState<ChatRoomSummary | null>(null)
    const [isLeavingRoom, setIsLeavingRoom] = useState(false)
    const [roomListWidth, setRoomListWidth] = useState(340)
    const [isRoomListResizing, setIsRoomListResizing] = useState(false)
    const wsRef = useRef<WebSocket | null>(null)
    const selectedRoomRef = useRef<ChatRoomSummary | null>(null)
    const inputRef = useRef('')
    const myUserIdRef = useRef<string | undefined>(undefined)
    const directRoomCreationRef = useRef<string | null>(null)
    const directRoomSelectionGenerationRef = useRef(0)
    const messageLayoutRef = useRef<HTMLDivElement | null>(null)
    const messageScrollRef = useRef<HTMLDivElement | null>(null)
    const conversationSearchRef = useRef<HTMLInputElement | null>(null)
    const contextMenuRef = useRef<HTMLDivElement | null>(null)
    const historyCursorRef = useRef<string | null>(null)
    const historyGenerationRef = useRef(0)
    const historyRequestActiveRef = useRef(false)
    const hasLoadedHistoryRef = useRef(false)
    const messageChangeVersionRef = useRef(0)
    const messageChangesRef = useRef(new Map<string, { version: number; change: ChatMessageChange }>())
    const isLoadingOlderMessagesRef = useRef(false)
    const shouldAutoScrollRef = useRef(true)
    const localTypingRef = useRef<{ roomId: string } | null>(null)
    const typingStopTimerRef = useRef<number | null>(null)
    const remoteTypingTimersRef = useRef<Record<string, number>>({})
    const rateLimitDeadlineRef = useRef(0)
    const localSendTimestampsRef = useRef<number[]>([])
    const pendingSendDraftsRef = useRef<PendingSendDraft[]>([])
    const rejectedSendDraftsRef = useRef<Record<string, string[]>>({})
    const standaloneRoomListRequestedRef = useRef(false)
    const createRoomDialogRef = useAccessibleDialog(isCreateRoomOpen, () => setIsCreateRoomOpen(false))
    const addMemberDialogRef = useAccessibleDialog(isAddMemberOpen, () => setIsAddMemberOpen(false))
    const leaveRoomDialogRef = useAccessibleDialog(!!leaveRoomTarget, () => setLeaveRoomTarget(null))
    const editMessageDialogRef = useAccessibleDialog(!!editingMessage, () => setEditingMessage(null))
    const deleteMessageDialogRef = useAccessibleDialog(!!deleteTarget, () => setDeleteTarget(null))

    const openMessageMenu = (
        message: ChatMessage,
        trigger: HTMLElement,
        coordinates?: { x: number; y: number },
    ) => {
        const rect = trigger.getBoundingClientRect()
        const x = coordinates?.x ?? rect.right - 160
        const y = coordinates?.y ?? rect.bottom + 4
        setContextMenu({
            message,
            trigger,
            x: Math.max(8, Math.min(x, window.innerWidth - 168)),
            y: Math.max(8, Math.min(y, window.innerHeight - 112)),
        })
    }

    const handleMessageMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const menu = contextMenuRef.current
        if (!menu) return
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)

        if (event.key === 'Escape') {
            event.preventDefault()
            const trigger = contextMenu?.trigger
            setContextMenu(null)
            window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }))
            return
        }
        let nextIndex = currentIndex
        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + items.length) % items.length
        else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
        else if (event.key === 'Home') nextIndex = 0
        else if (event.key === 'End') nextIndex = items.length - 1
        else return

        event.preventDefault()
        items[nextIndex]?.focus()
    }

    const handleMessageMenuBlur = (event: React.FocusEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setContextMenu(null)
        }
    }

    const selectRoom = (room: ChatRoomSummary | null) => {
        if (room) standaloneRoomListRequestedRef.current = false
        const roomChanged = selectedRoomRef.current?.roomId !== room?.roomId
        if (roomChanged) {
            historyGenerationRef.current += 1
            historyRequestActiveRef.current = false
            hasLoadedHistoryRef.current = false
            messageChangesRef.current.clear()
            shouldAutoScrollRef.current = true
            historyCursorRef.current = null
            isLoadingOlderMessagesRef.current = false
            setMessages([])
            setHistoryLoading(!!room)
            setOlderMessagesLoading(false)
        }
        selectedRoomRef.current = room
        setSelectedRoom(room)
    }

    const applyMessageChange = (change: ChatMessageChange) => {
        messageChangesRef.current.set(change.id, { version: ++messageChangeVersionRef.current, change })
        setMessages((current) => mergeChatHistory(change.createdAt ? [change as ChatMessage] : [], current, [change]))
    }

    const refreshHistory = async () => {
        const roomId = selectedRoomRef.current?.roomId
        if (!roomId) return
        const generation = ++historyGenerationRef.current
        const changeVersion = hasLoadedHistoryRef.current ? messageChangeVersionRef.current : 0
        const oldestKnownId = messagesRef.current[0]?.id
        const isCurrent = () => generation === historyGenerationRef.current && selectedRoomRef.current?.roomId === roomId
        historyRequestActiveRef.current = true
        isLoadingOlderMessagesRef.current = false
        setOlderMessagesLoading(false)
        setHistoryLoading(messagesRef.current.length === 0)
        try {
            const page = await loadChatHistory(
                (beforeMessageId) => getChatHistory(roomId, beforeMessageId),
                oldestKnownId,
                isCurrent,
            )
            if (!page) return
            const changes = [...messageChangesRef.current.values()]
                .filter(({ version }) => version > changeVersion)
                .map(({ change }) => change)
            setMessages((current) => mergeChatHistory(page.messages, current, changes))
            hasLoadedHistoryRef.current = true
            historyCursorRef.current = page.hasMore ? page.messages[0]?.id ?? null : null
            setChatError((error) => error === '메시지를 불러오지 못했어요.' ? null : error)
        } catch (error) {
            console.error('[chat] 이력 조회 실패', error)
            if (isCurrent()) setChatError('메시지를 불러오지 못했어요.')
        } finally {
            if (isCurrent()) {
                historyRequestActiveRef.current = false
                setHistoryLoading(false)
            }
        }
    }

    const queueRejectedSendDraft = (draft: PendingSendDraft) => {
        const queuedDrafts = rejectedSendDraftsRef.current[draft.roomId] ?? []
        rejectedSendDraftsRef.current[draft.roomId] = [...queuedDrafts, draft.content]
    }

    const restoreOrQueueRejectedSendDraft = (draft: PendingSendDraft) => {
        const canRestoreNow = selectedRoomRef.current?.roomId === draft.roomId &&
            !inputRef.current.trim()
        if (canRestoreNow) {
            inputRef.current = draft.content
            setInput(draft.content)
            return
        }
        queueRejectedSendDraft(draft)
    }

    const recoverPendingSendDrafts = () => {
        const unresolvedDrafts = pendingSendDraftsRef.current
        pendingSendDraftsRef.current = []
        unresolvedDrafts.forEach(restoreOrQueueRejectedSendDraft)
    }

    const applyRateLimit = (retryAfterSeconds: number, message = DEFAULT_MESSAGE_RATE_LIMIT_MESSAGE) => {
        const safeMessage = message.trim() || DEFAULT_MESSAGE_RATE_LIMIT_MESSAGE
        const nextDeadline = Date.now() + Math.ceil(retryAfterSeconds * 1000)
        const mergedDeadline = Math.max(rateLimitDeadlineRef.current, nextDeadline)
        rateLimitDeadlineRef.current = mergedDeadline
        setRateLimitDeadline(mergedDeadline)
        setRateLimitRemainingSeconds(Math.max(1, Math.ceil((mergedDeadline - Date.now()) / 1000)))
        setRateLimitMessage(safeMessage)
        setRateLimitAnnouncement(`${safeMessage} 잠시 기다려주세요.`)
    }

    useEffect(() => {
        if (rateLimitDeadline <= 0) return

        const updateRemainingSeconds = () => {
            const remainingSeconds = Math.max(
                0,
                Math.ceil((rateLimitDeadlineRef.current - Date.now()) / 1000),
            )
            setRateLimitRemainingSeconds(remainingSeconds)

            if (remainingSeconds === 0) {
                rateLimitDeadlineRef.current = 0
                localSendTimestampsRef.current = []
                setRateLimitDeadline(0)
                setRateLimitMessage(DEFAULT_MESSAGE_RATE_LIMIT_MESSAGE)
                setRateLimitAnnouncement('메시지를 다시 보낼 수 있어요.')
            }
        }

        updateRemainingSeconds()
        const timer = window.setInterval(updateRemainingSeconds, 1000)
        return () => window.clearInterval(timer)
    }, [rateLimitDeadline])

    useEffect(() => {
        const roomId = selectedRoom?.roomId
        if (!roomId || inputRef.current.trim()) return

        const queuedDrafts = rejectedSendDraftsRef.current[roomId]
        const rejectedDraft = queuedDrafts?.[0]
        if (!rejectedDraft) return
        if (inputRef.current.trim()) return

        if (queuedDrafts.length === 1) {
            delete rejectedSendDraftsRef.current[roomId]
        } else {
            rejectedSendDraftsRef.current[roomId] = queuedDrafts.slice(1)
        }
        inputRef.current = rejectedDraft
        setInput(rejectedDraft)
    }, [input, selectedRoom?.roomId])

    const stopTyping = () => {
        if (typingStopTimerRef.current !== null) {
            window.clearTimeout(typingStopTimerRef.current)
            typingStopTimerRef.current = null
        }

        const localTyping = localTypingRef.current
        if (!localTyping) return

        const socket = wsRef.current
        if (socket) {
            sendChatTyping(socket, localTyping.roomId, false)
        }
        localTypingRef.current = null
    }

    const updatePartnerTyping = (userId: string, isTyping: boolean) => {
        const existingTimer = remoteTypingTimersRef.current[userId]
        if (existingTimer !== undefined) {
            window.clearTimeout(existingTimer)
            delete remoteTypingTimersRef.current[userId]
        }

        setTypingUsers((current) => {
            if (isTyping) {
                return current[userId] ? current : { ...current, [userId]: true }
            }

            if (!current[userId]) return current
            const { [userId]: _, ...withoutUser } = current
            return withoutUser
        })

        if (isTyping) {
            remoteTypingTimersRef.current[userId] = window.setTimeout(() => {
                delete remoteTypingTimersRef.current[userId]
                setTypingUsers((current) => {
                    if (!current[userId]) return current
                    const { [userId]: _, ...withoutUser } = current
                    return withoutUser
                })
            }, 3000)
        }
    }

    const startTypingIfNeeded = () => {
        if (!selectedRoom) return

        const activeTyping = localTypingRef.current
        if (activeTyping && activeTyping.roomId !== selectedRoom.roomId) {
            stopTyping()
        }

        if (!localTypingRef.current) {
            const socket = wsRef.current
            if (socket && sendChatTyping(socket, selectedRoom.roomId, true)) {
                localTypingRef.current = { roomId: selectedRoom.roomId }
            }
        }
    }

    const scheduleTypingStop = () => {
        if (typingStopTimerRef.current !== null) {
            window.clearTimeout(typingStopTimerRef.current)
        }
        typingStopTimerRef.current = window.setTimeout(() => stopTyping(), 2000)
    }

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const nextInput = event.target.value
        inputRef.current = nextInput
        setInput(nextInput)

        if (!selectedRoom || !nextInput.trim()) {
            stopTyping()
            return
        }

        startTypingIfNeeded()
        scheduleTypingStop()
    }

    const handleInputCompositionStart = () => {
        if (!selectedRoom) return
        startTypingIfNeeded()
        scheduleTypingStop()
    }

    const handleInputCompositionUpdate = () => {
        if (!selectedRoom) return
        startTypingIfNeeded()
        scheduleTypingStop()
    }

    const myProfileQuery = useQuery<UserProfileResponse>({
        queryKey: ['my-profile-for-message'],
        queryFn: getMyProfile,
    })

    useEffect(() => {
        myUserIdRef.current = myProfileQuery.data?.userId
    }, [myProfileQuery.data?.userId])

    const roomsQuery = useQuery<ChatRoomSummary[]>({
        queryKey: ['message-rooms'],
        queryFn: getChatRooms,
        refetchInterval: 10_000,
    })
    const roomsRefetchRef = useRef(roomsQuery.refetch)

    useEffect(() => {
        roomsRefetchRef.current = roomsQuery.refetch
    }, [roomsQuery.refetch])

    const roomPreviews = useMemo(() => {
        const rooms = roomsQuery.data ?? []
        return Object.fromEntries(rooms.map((room) => [room.roomId, roomPreviewText(room.lastMessage)]))
    }, [roomsQuery.data])

    const targetUserQuery = useQuery<UserProfileResponse>({
        queryKey: ['message-target-user', targetUsername],
        queryFn: () => getUserProfileByUsername(targetUsername),
        enabled: !!targetUsername,
    })

    const myFriendsQuery = useQuery<FriendItem[]>({
        queryKey: ['message-room-invite-friends'],
        queryFn: () => getMyFriends(0, 200),
        enabled: isCreateRoomOpen || isAddMemberOpen,
        staleTime: 60_000,
    })

    const inviteInputUsernames = useMemo(() => parseInviteUsernames(newRoomMemberNames), [newRoomMemberNames])
    const inviteKeyword = useMemo(() => {
        const lastSegment = newRoomMemberNames.split(',').at(-1)
        return (lastSegment || '').trim()
    }, [newRoomMemberNames])
    const inviteSuggestions = useMemo(() => {
        const selected = new Set(inviteInputUsernames.map((username) => username.toLowerCase()))
        const candidates = myFriendsQuery.data ?? []
        const filtered = candidates
            .filter((item) => !selected.has(item.username.toLowerCase()))
            .filter((item) => !inviteKeyword || item.username.toLowerCase().includes(inviteKeyword.toLowerCase()))

        return filtered.slice(0, 6)
    }, [inviteInputUsernames, inviteKeyword, myFriendsQuery.data])

    const handleSelectInviteUsername = (username: string) => {
        const segments = newRoomMemberNames.split(',')
        const committedUsernames = segments
            .slice(0, -1)
            .map((item) => item.trim())
            .filter(Boolean)
        if (!committedUsernames.some((item) => item.toLowerCase() == username.toLowerCase())) {
            committedUsernames.push(username)
        }
        setNewRoomMemberNames(`${committedUsernames.join(', ')}, `)
    }

    const addMemberInputUsernames = useMemo(() => parseInviteUsernames(addMemberNames), [addMemberNames])
    const addMemberKeyword = useMemo(() => {
        const lastSegment = addMemberNames.split(',').at(-1)
        return (lastSegment || '').trim()
    }, [addMemberNames])
    const addMemberSuggestions = useMemo(() => {
        const selected = new Set(addMemberInputUsernames.map((username) => username.toLowerCase()))
        const existingMemberUsernames = new Set(
            (selectedRoom?.members ?? []).map((member) => member.username.toLowerCase()),
        )
        const candidates = myFriendsQuery.data ?? []
        return candidates
            .filter((item) => !selected.has(item.username.toLowerCase()))
            .filter((item) => !existingMemberUsernames.has(item.username.toLowerCase()))
            .filter((item) => !addMemberKeyword || item.username.toLowerCase().includes(addMemberKeyword.toLowerCase()))
            .slice(0, 6)
    }, [addMemberInputUsernames, addMemberKeyword, myFriendsQuery.data, selectedRoom])

    const handleSelectAddMemberUsername = (username: string) => {
        const segments = addMemberNames.split(',')
        const committedUsernames = segments
            .slice(0, -1)
            .map((item) => item.trim())
            .filter(Boolean)
        if (!committedUsernames.some((item) => item.toLowerCase() === username.toLowerCase())) {
            committedUsernames.push(username)
        }
        setAddMemberNames(`${committedUsernames.join(', ')}, `)
    }

    const rooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data])

    const filteredRooms = useMemo(() => {
        if (!keyword.trim()) return rooms
        const normalizedKeyword = keyword.toLowerCase()
        return rooms.filter((room) => getRoomDisplayName(room, myProfileQuery.data?.userId).toLowerCase().includes(normalizedKeyword))
    }, [rooms, keyword, myProfileQuery.data?.userId])

    useEffect(() => {
        if (standalone && standaloneRoomListRequestedRef.current) {
            setDirectRoomCreating(false)
            return
        }

        const myUserId = myProfileQuery.data?.userId
        const targetUserId = targetUserQuery.data?.userId
        if (!myUserId || !targetUserId || targetUserId === myUserId) {
            setDirectRoomCreating(false)
            return
        }

        const existingRoom = rooms.find((room) => isDirectRoomWithUser(room, myUserId, targetUserId))
        if (existingRoom) {
            setDirectRoomCreating(false)
            if (selectedRoom?.roomId !== existingRoom.roomId) selectRoom(existingRoom)
            return
        }
        if (directRoomCreationRef.current === targetUserId) return

        directRoomCreationRef.current = targetUserId
        const selectionGeneration = directRoomSelectionGenerationRef.current
        setDirectRoomCreating(true)
        void createChatRoom({ memberUserIds: [targetUserId] })
            .then(async (room) => {
                if (
                    directRoomSelectionGenerationRef.current === selectionGeneration &&
                    (!standalone || !standaloneRoomListRequestedRef.current)
                ) {
                    selectRoom(room)
                }
                await roomsQuery.refetch()
            })
            .catch((error) => {
                setChatError(
                    resolveChatRoomErrorMessage(error)
                    ?? '대화방을 만들지 못했어요. 잠시 후 다시 시도해주세요.',
                )
            })
            .finally(() => {
                directRoomCreationRef.current = null
                setDirectRoomCreating(false)
            })
    }, [myProfileQuery.data?.userId, rooms, roomsQuery, selectedRoom?.roomId, standalone, targetUserQuery.data?.userId])

    useEffect(() => {
        // Only auto-pick the first room when nothing is selected yet. If a room IS selected
        // but momentarily missing from this `rooms` snapshot (e.g. right after creating a room,
        // before roomsQuery has refetched), leave it alone instead of falling back to rooms[0] —
        // otherwise a freshly created/selected room gets clobbered by a stale list on the next render.
        // Explicit removal (e.g. leaving a room) clears selectedRoom itself, so this doesn't need to.
        if (selectedRoom === null) {
            if (!standalone || !standaloneRoomListRequestedRef.current) {
                selectRoom(rooms[0] ?? null)
            }
            return
        }

        const refreshedSelectedRoom = rooms.find((room) => room.roomId === selectedRoom.roomId)
        if (refreshedSelectedRoom && refreshedSelectedRoom !== selectedRoom) {
            selectRoom(refreshedSelectedRoom)
        }
    }, [rooms, selectedRoom, standalone])

    useEffect(() => {
        let closed = false
        let socket: WebSocket | null = null
        let reconnectTimer: number | null = null
        let reconnectAttempt = 0

        const scheduleReconnect = () => {
            if (closed || reconnectTimer !== null) return
            const delay = Math.min(1_000 * 2 ** reconnectAttempt, 15_000)
            reconnectAttempt += 1
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null
                connect()
            }, delay)
        }

        const connect = () => {
            if (closed) return
            const nextSocket = createChatWebSocket()
            socket = nextSocket
            wsRef.current = nextSocket

            nextSocket.onopen = () => {
                reconnectAttempt = 0
                void roomsRefetchRef.current()
                void refreshHistory()
            }

            nextSocket.onmessage = (event) => {
                try {
                    const frame: unknown = JSON.parse(event.data)
                    if (isChatMessageRateLimitedFrame(frame)) {
                        setChatError(null)
                        applyRateLimit(frame.retryAfterSeconds, frame.message)

                        const pendingIndex = pendingSendDraftsRef.current.findIndex((draft) => (
                            draft.roomId === frame.roomId && draft.content === frame.content
                        ))
                        const pendingDraft = pendingIndex >= 0
                            ? pendingSendDraftsRef.current[pendingIndex]
                            : undefined
                        if (pendingIndex >= 0) {
                            pendingSendDraftsRef.current = pendingSendDraftsRef.current.filter((_, index) => (
                                index !== pendingIndex
                            ))
                        }
                        const rejectedDraft = pendingDraft ?? {
                            roomId: frame.roomId,
                            content: frame.content,
                        }
                        restoreOrQueueRejectedSendDraft(rejectedDraft)
                        return
                    }

                    if (isChatTypingFrame(frame)) {
                        if (selectedRoomRef.current?.roomId === frame.roomId) {
                            updatePartnerTyping(frame.senderUserId, frame.isTyping)
                        }
                        return
                    }

                    if (isChatMessageUpdatedFrame(frame)) {
                        if (selectedRoomRef.current?.roomId !== frame.message.roomId) {
                            void roomsRefetchRef.current()
                            return
                        }
                        const updated = frame.message
                        applyMessageChange(updated)
                        void roomsRefetchRef.current()
                        return
                    }

                    if (isChatMessageDeletedFrame(frame)) {
                        if (selectedRoomRef.current?.roomId !== frame.roomId) {
                            void roomsRefetchRef.current()
                            return
                        }
                        applyMessageChange({ id: frame.messageId, status: frame.status, content: '' })
                        void roomsRefetchRef.current()
                        return
                    }

                    const message = frame as ChatMessage
                    if (!message.roomId) return
                    if (message.senderUserId === myUserIdRef.current) {
                        const pendingIndex = pendingSendDraftsRef.current.findIndex((draft) => (
                            draft.roomId === message.roomId && draft.content === message.content
                        ))
                        if (pendingIndex >= 0) {
                            pendingSendDraftsRef.current = pendingSendDraftsRef.current.filter((_, index) => (
                                index !== pendingIndex
                            ))
                        }
                    }
                    updatePartnerTyping(message.senderUserId, false)
                    if (selectedRoomRef.current?.roomId !== message.roomId) {
                        void roomsRefetchRef.current()
                        return
                    }
                    applyMessageChange(message)
                    if (message.senderUserId !== myUserIdRef.current) {
                        const preview = message.content.length > 120
                            ? `${message.content.slice(0, 120)}…`
                            : message.content
                        setMessageAnnouncement(`${message.senderUsername}님의 새 메시지: ${preview}`)
                    }
                    void roomsRefetchRef.current()
                } catch {
                    // ignore malformed event
                }
            }

            nextSocket.onclose = () => {
                if (wsRef.current === nextSocket) wsRef.current = null
                if (!closed && pendingSendDraftsRef.current.length > 0) {
                    recoverPendingSendDrafts()
                    setChatError('연결이 끊겨 전송을 확인하지 못한 메시지를 입력창에 복구했어요.')
                }
                scheduleReconnect()
            }

            nextSocket.onerror = () => nextSocket.close()
        }

        connect()

        return () => {
            closed = true
            if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
            socket?.close()
            wsRef.current = null
            Object.values(remoteTypingTimersRef.current).forEach((timer) => window.clearTimeout(timer))
            remoteTypingTimersRef.current = {}
        }
    }, [])

    useEffect(() => {
        return () => stopTyping()
    }, [selectedRoom?.roomId, selectedRoom?.lastMessageAt])

    useEffect(() => {
        if (!contextMenu) return
        const focusFrame = window.requestAnimationFrame(() => {
            contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
        })
        const closeMenu = () => setContextMenu(null)
        window.addEventListener('pointerdown', closeMenu)
        window.addEventListener('blur', closeMenu)
        return () => {
            window.cancelAnimationFrame(focusFrame)
            window.removeEventListener('pointerdown', closeMenu)
            window.removeEventListener('blur', closeMenu)
        }
    }, [contextMenu])

    useEffect(() => {
        if (!roomContextMenu) return
        const closeMenu = () => setRoomContextMenu(null)
        window.addEventListener('pointerdown', closeMenu)
        window.addEventListener('blur', closeMenu)
        return () => {
            window.removeEventListener('pointerdown', closeMenu)
            window.removeEventListener('blur', closeMenu)
        }
    }, [roomContextMenu])

    useEffect(() => {
        void refreshHistory()
        return () => {
            historyGenerationRef.current += 1
        }
    }, [selectedRoom?.roomId])

    const loadOlderMessages = async () => {
        const room = selectedRoomRef.current
        const beforeMessageId = historyCursorRef.current
        if (!room || !beforeMessageId || isLoadingOlderMessagesRef.current || historyRequestActiveRef.current) return
        const generation = historyGenerationRef.current
        const changeVersion = messageChangeVersionRef.current
        const isCurrent = () => generation === historyGenerationRef.current && selectedRoomRef.current?.roomId === room.roomId

        isLoadingOlderMessagesRef.current = true
        setOlderMessagesLoading(true)
        const scrollContainer = messageScrollRef.current
        const previousScrollHeight = scrollContainer?.scrollHeight ?? 0
        const previousScrollTop = scrollContainer?.scrollTop ?? 0

        try {
            const page = await getChatHistory(room.roomId, beforeMessageId)
            if (!isCurrent()) return

            const changes = [...messageChangesRef.current.values()]
                .filter(({ version }) => version > changeVersion)
                .map(({ change }) => change)
            setMessages((current) => mergeChatHistory(page.messages, current, changes))
            historyCursorRef.current = page.hasMore ? page.messages[0]?.id ?? null : null

            window.requestAnimationFrame(() => {
                if (!scrollContainer || !isCurrent()) return
                scrollContainer.scrollTop = previousScrollTop + scrollContainer.scrollHeight - previousScrollHeight
            })
        } catch (error) {
            console.error('[chat] 이전 이력 조회 실패', error)
            if (isCurrent()) setChatError('이전 메시지를 불러오지 못했어요.')
        } finally {
            if (isCurrent()) {
                isLoadingOlderMessagesRef.current = false
                setOlderMessagesLoading(false)
            }
        }
    }

    const handleMessageScroll = (event: React.UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget
        const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
        shouldAutoScrollRef.current = distanceFromBottom <= 96
        if (target.scrollTop <= 24) {
            void loadOlderMessages()
        }
    }

    useEffect(() => {
        const messageScroll = messageScrollRef.current
        if (!messageScroll || !shouldAutoScrollRef.current) return

        messageScroll.scrollTo({
            top: messageScroll.scrollHeight,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        })
    }, [messages[messages.length - 1]?.id])

    const handleSend = () => {
        const text = input.trim()
        if (!selectedRoom || !text) return
        if (!myProfileQuery.data?.userId) {
            setChatError('사용자 정보를 불러오는 중이에요. 잠시 후 다시 보내주세요.')
            return
        }

        shouldAutoScrollRef.current = true

        stopTyping()
        setChatError(null)

        const now = Date.now()
        if (rateLimitDeadlineRef.current > now) {
            setRateLimitRemainingSeconds(Math.ceil((rateLimitDeadlineRef.current - now) / 1000))
            return
        }

        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setChatError('실시간 연결을 복구 중이에요. 연결된 뒤 다시 보내주세요.')
            return
        }

        const recentSendTimestamps = localSendTimestampsRef.current.filter((timestamp) => (
            now - timestamp < MESSAGE_RATE_WINDOW_MS
        ))
        localSendTimestampsRef.current = recentSendTimestamps
        if (recentSendTimestamps.length >= MESSAGE_RATE_WINDOW_LIMIT) {
            applyRateLimit(MESSAGE_RATE_LIMIT_SECONDS)
            return
        }

        const pendingDraft: PendingSendDraft = {
            roomId: selectedRoom.roomId,
            content: text,
        }
        pendingSendDraftsRef.current = [...pendingSendDraftsRef.current, pendingDraft]

        try {
            ws.send(JSON.stringify({ roomId: selectedRoom.roomId, content: text }))
            localSendTimestampsRef.current = [...recentSendTimestamps, now]
            inputRef.current = ''
            setInput('')
        } catch (e) {
            pendingSendDraftsRef.current = pendingSendDraftsRef.current.filter((draft) => draft !== pendingDraft)
            console.error('[chat] 전송 실패', e)
            setChatError('메시지 전송에 실패했어요. 잠시 후 다시 시도해주세요.')
        }
    }

    const handleCreateRoom = async () => {
        const usernames = parseInviteUsernames(newRoomMemberNames)
        if (usernames.length === 0 || isCreatingRoom) return

        setIsCreatingRoom(true)
        setChatError(null)
        try {
            const myUserId = myProfileQuery.data?.userId
            const profiles = await Promise.all(usernames.map((username) => getUserProfileByUsername(username)))
            const memberUserIds = [...new Set(profiles.map((profile) => profile.userId))]
                .filter((userId) => userId !== myUserId)
            if (memberUserIds.length === 0) {
                setChatError('자기 자신만으로는 대화방을 만들 수 없어요. 다른 사용자를 초대해주세요.')
                return
            }

            const room = await createChatRoom({
                title: newRoomTitle.trim() || undefined,
                memberUserIds,
            })
            selectRoom(room)
            setNewRoomTitle('')
            setNewRoomMemberNames('')
            setIsCreateRoomOpen(false)
            await roomsQuery.refetch()
        } catch (error) {
            console.error('[chat] 채팅방 생성 실패', error)
            setChatError(
                resolveChatRoomErrorMessage(error)
                ?? '채팅방을 만들지 못했어요. 사용자명을 확인한 뒤 다시 시도해주세요.',
            )
        } finally {
            setIsCreatingRoom(false)
        }
    }

    const handleAddMembers = async () => {
        const usernames = parseInviteUsernames(addMemberNames)
        if (!selectedRoom || usernames.length === 0 || isAddingMember) return

        setIsAddingMember(true)
        setChatError(null)
        try {
            const myUserId = myProfileQuery.data?.userId
            const profiles = await Promise.all(usernames.map((username) => getUserProfileByUsername(username)))
            const existingMemberIds = new Set(selectedRoom.members.map((member) => member.userId))
            const memberUserIds = [...new Set(profiles.map((profile) => profile.userId))]
                .filter((userId) => userId !== myUserId && !existingMemberIds.has(userId))
            if (memberUserIds.length === 0) {
                setChatError('추가할 수 있는 새로운 사용자가 없어요.')
                return
            }

            const updatedRoom = await addChatRoomMembers(selectedRoom.roomId, memberUserIds)
            selectRoom(updatedRoom)
            setAddMemberNames('')
            setIsAddMemberOpen(false)
            await roomsQuery.refetch()
        } catch (error) {
            console.error('[chat] 멤버 추가 실패', error)
            setChatError(
                resolveChatRoomErrorMessage(error)
                ?? '멤버를 추가하지 못했어요. 사용자명을 확인한 뒤 다시 시도해주세요.',
            )
        } finally {
            setIsAddingMember(false)
        }
    }

    const handleLeaveRoom = async () => {
        const room = leaveRoomTarget
        if (!room || isLeavingRoom) return

        setIsLeavingRoom(true)
        setChatError(null)
        try {
            await leaveChatRoom(room.roomId)
            setLeaveRoomTarget(null)
            if (selectedRoom?.roomId === room.roomId) selectRoom(null)
            await roomsQuery.refetch()
        } catch (error) {
            console.error('[chat] 채팅방 나가기 실패', error)
            setChatError('채팅방을 나가지 못했어요. 잠시 후 다시 시도해주세요.')
        } finally {
            setIsLeavingRoom(false)
        }
    }

    const handleEditMessage = async () => {
        const message = editingMessage
        const nextText = editText.trim()
        if (!message || !nextText || messageActionLoading) return

        setMessageActionLoading(true)
        setChatError(null)
        try {
            const updated = await updateChatMessage(message.id, { content: nextText })
            if (selectedRoomRef.current?.roomId === updated.roomId) applyMessageChange(updated)
            setEditingMessage(null)
            await roomsQuery.refetch()
        } catch (e) {
            console.error('[chat] 수정 실패', e)
            setChatError(e instanceof Error ? e.message : '메시지 수정에 실패했어요.')
        } finally {
            setMessageActionLoading(false)
        }
    }

    const handleDeleteMessage = async () => {
        const message = deleteTarget
        if (!message || messageActionLoading) return

        setMessageActionLoading(true)
        setChatError(null)
        try {
            await deleteChatMessage(message.id)
            if (selectedRoomRef.current?.roomId === message.roomId) {
                applyMessageChange({ id: message.id, status: 'DELETED', content: '' })
            }
            setDeleteTarget(null)
            await roomsQuery.refetch()
        } catch (e) {
            console.error('[chat] 삭제 실패', e)
            setChatError('메시지 삭제에 실패했어요.')
        } finally {
            setMessageActionLoading(false)
        }
    }

    const handleRoomListResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsRoomListResizing(true)
    }

    const handleRoomListResize = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isRoomListResizing) return
        const layout = messageLayoutRef.current
        if (!layout) return

        const { left, width } = layout.getBoundingClientRect()
        const maxWidth = Math.min(MAX_ROOM_LIST_WIDTH, width - MIN_CONVERSATION_WIDTH)
        const nextWidth = Math.min(Math.max(event.clientX - left, MIN_ROOM_LIST_WIDTH), maxWidth)
        setRoomListWidth(nextWidth)
    }

    const handleRoomListResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        setIsRoomListResizing(false)
    }

    const handleRoomListResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const delta = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
        if (!delta) return
        event.preventDefault()
        setRoomListWidth((current) => Math.min(MAX_ROOM_LIST_WIDTH, Math.max(MIN_ROOM_LIST_WIDTH, current + delta)))
    }

    const myUserId = myProfileQuery.data?.userId
    const myUsername = myProfileQuery.data?.username
    const typingMemberNames = selectedRoom
        ? selectedRoom.members
            .filter((member) => typingUsers[member.userId])
            .map((member) => member.username)
        : []
    const partnerIsTyping = typingMemberNames.length > 0
    const roomListLoading = roomsQuery.isLoading || myProfileQuery.isLoading
    const conversationBootstrapping = roomListLoading || (!!targetUsername && targetUserQuery.isLoading)

    return (
        <div
            ref={messageLayoutRef}
            className={`flex w-full min-w-0 ${standalone ? 'h-full' : 'h-[calc(100dvh-64px-80px-env(safe-area-inset-bottom))] lg:h-[calc(100vh-64px)]'} ${isRoomListResizing ? 'select-none cursor-col-resize' : ''}`}
        >
            <div
                className={`${selectedRoom ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-line bg-panel md:w-[var(--room-list-width)]`}
                style={{ '--room-list-width': `${roomListWidth}px` } as React.CSSProperties}
            >
                <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                    <h1 className="text-xl font-bold text-ink">메시지</h1>
                    <button
                        type="button"
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface hover:text-sub"
                        aria-label="새 대화 만들기"
                        title="새 대화 만들기"
                        onClick={() => setIsCreateRoomOpen(true)}
                    >
                        <FiPlus size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="px-4 pb-3">
                    <div className="relative">
                        <label htmlFor="conversation-search" className="sr-only">대화 검색</label>
                        <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                        <input
                            ref={conversationSearchRef}
                            id="conversation-search"
                            name="conversationSearch"
                            autoComplete="off"
                            className="conversation-search-input h-11 w-full rounded-lg bg-surface pl-10 pr-3 text-sm text-ink placeholder:text-muted"
                            placeholder="예: 대화방 또는 사용자 검색…"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {roomListLoading ? (
                        <ChatRoomListSkeleton />
                    ) : filteredRooms.length === 0 ? (
                        <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center" role="status">
                            <p className="text-sm text-sub">
                                {keyword.trim() ? '일치하는 대화가 없어요.' : '아직 대화가 없어요.'}
                            </p>
                            {keyword.trim() && (
                                <button
                                    type="button"
                                    className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold text-ink hover:bg-surface"
                                    onClick={() => {
                                        setKeyword('')
                                        window.requestAnimationFrame(() => conversationSearchRef.current?.focus())
                                    }}
                                >
                                    검색 초기화
                                </button>
                            )}
                        </div>
                    ) : (
                        filteredRooms.map((room) => {
                            const active = selectedRoom?.roomId === room.roomId
                            const avatarMember = getRoomAvatarMember(room, myProfileQuery.data?.userId)
                            const displayName = getRoomDisplayName(room, myProfileQuery.data?.userId)
                            return (
                                <button
                                    key={room.roomId}
                                    className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-surface transition-colors ${
                                        active ? 'bg-surface' : ''
                                    }`}
                                    onClick={() => selectRoom(room)}
                                    onContextMenu={(event) => {
                                        event.preventDefault()
                                        setRoomContextMenu({
                                            room,
                                            x: Math.min(event.clientX, window.innerWidth - 176),
                                            y: Math.min(event.clientY, window.innerHeight - 60),
                                        })
                                    }}
                                >
                                    <ChatAvatar
                                        imageKey={avatarMember?.profileImageUrl}
                                        alt={`${displayName} 프로필`}
                                        className="h-11 w-11 shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold text-ink truncate">{displayName}</span>
                                            <span className="text-xs text-muted shrink-0 ml-2">{formatRelative(room.lastMessageAt)}</span>
                                        </div>
                                        <div className="mt-0.5">
                                            <span className="text-sm text-sub truncate block">{roomPreviews[room.roomId] || '대화를 시작해보세요.'}</span>
                                        </div>
                                    </div>
                                </button>
                            )
                        })
                    )}
                </div>
            </div>

            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="채팅방 목록 너비 조절"
                aria-valuemin={MIN_ROOM_LIST_WIDTH}
                aria-valuemax={MAX_ROOM_LIST_WIDTH}
                aria-valuenow={roomListWidth}
                tabIndex={0}
                className="relative z-10 -ml-1 hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center group md:flex"
                onPointerDown={handleRoomListResizeStart}
                onPointerMove={handleRoomListResize}
                onPointerUp={handleRoomListResizeEnd}
                onPointerCancel={handleRoomListResizeEnd}
                onKeyDown={handleRoomListResizeKeyDown}
            >
                <span className="h-10 w-1 rounded-full bg-transparent transition-colors group-hover:bg-brand/70" />
            </div>

            <div className={`${selectedRoom ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-panel`}>
                <div className="h-16 px-3 sm:px-6 flex items-center justify-between border-b border-line">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            className="flex h-11 w-11 items-center justify-center rounded-xl text-sub hover:bg-surface md:hidden"
                            onClick={() => {
                                directRoomSelectionGenerationRef.current += 1
                                standaloneRoomListRequestedRef.current = true
                                if (targetUsername) {
                                    const nextSearchParams = new URLSearchParams(searchParams)
                                    nextSearchParams.delete('user')
                                    setSearchParams(nextSearchParams, { replace: true })
                                }
                                selectRoom(null)
                            }}
                            aria-label="대화 목록으로 돌아가기"
                        >
                            <ChevronLeftIcon size={22} />
                        </button>
                        {conversationBootstrapping && !selectedRoom ? (
                            <div
                                className="flex animate-pulse items-center gap-3"
                                role="status"
                                aria-label="대화 정보를 불러오는 중"
                                aria-busy="true"
                            >
                                <span className="h-9 w-9 shrink-0 rounded-full bg-placeholder" aria-hidden="true" />
                                <div className="space-y-2" aria-hidden="true">
                                    <span className="block h-4 w-28 rounded bg-placeholder" />
                                    <span className="block h-3 w-20 rounded bg-placeholder" />
                                </div>
                            </div>
                        ) : (
                            <>
                                <ChatAvatar
                                    imageKey={selectedRoom ? getRoomAvatarMember(selectedRoom, myUserId)?.profileImageUrl : undefined}
                                    alt={selectedRoom ? `${getRoomDisplayName(selectedRoom, myUserId)} 프로필` : ''}
                                    className="h-9 w-9 shrink-0"
                                />
                                <div>
                                    <div className="text-sm font-bold text-ink">{selectedRoom ? getRoomDisplayName(selectedRoom, myUserId) : '대화 상대를 선택하세요'}</div>
                                    <div className={`text-xs flex items-center gap-1 ${partnerIsTyping ? 'text-sub' : 'text-success'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${partnerIsTyping ? 'bg-sub animate-pulse' : 'bg-success'}`} />
                                        {partnerIsTyping ? `${typingMemberNames.join(', ')} 입력 중` : `${selectedRoom?.members.length ?? 0}명 참여 중`}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                    {selectedRoom && (
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface hover:text-sub"
                                aria-label="멤버 추가"
                                title="멤버 추가"
                                onClick={() => setIsAddMemberOpen(true)}
                            >
                                <FiUserPlus size={18} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface hover:text-danger"
                                aria-label="채팅방 나가기"
                                title="채팅방 나가기"
                                onClick={() => setLeaveRoomTarget(selectedRoom)}
                            >
                                <FiLogOut size={18} aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </div>

                {!selectedRoom ? (
                    conversationBootstrapping ? (
                        <div className="flex-1 min-w-0 overflow-hidden px-4 py-5 sm:px-6">
                            <ChatMessageListSkeleton />
                        </div>
                    ) : directRoomCreating ? (
                        <div
                            className="flex flex-1 min-w-0 items-center justify-center px-6 text-center text-sm text-sub"
                            role="status"
                            aria-live="polite"
                        >
                            대화방을 만드는 중입니다.
                        </div>
                    ) : (
                        <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                            {rooms.length === 0 ? (
                                <>
                                    <p className="text-sm text-sub">아직 대화가 없어요.</p>
                                    <button
                                        type="button"
                                        className="min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-on-brand hover:brightness-95"
                                        onClick={() => setIsCreateRoomOpen(true)}
                                    >
                                        새 대화 시작하기
                                    </button>
                                </>
                            ) : (
                                <p className="text-sm text-sub">대화를 선택해주세요.</p>
                            )}
                        </div>
                    )
                ) : (
                <div
                    ref={messageScrollRef}
                    className="flex-1 min-w-0 overflow-y-auto px-4 py-5 sm:px-6"
                    onScroll={handleMessageScroll}
                >
                    <div className="mx-auto w-full max-w-5xl space-y-3">
                        {historyLoading ? (
                            <ChatMessageListSkeleton />
                        ) : (
                            <>
                            {olderMessagesLoading && <ChatMessageListSkeleton count={2} />}
                            {messages.map((message, index) => {
                        const mine =
                            message.senderUserId === myUserId ||
                            message.senderUsername === myUsername
                        const canModify = mine && message.status !== 'DELETED'
                        const showSenderName = !mine && (
                            index === 0 || messages[index - 1].senderUserId !== message.senderUserId
                        )
                        const previousMessage = messages[index - 1]
                        const showMessageTime = index === 0 ||
                            previousMessage.senderUserId !== message.senderUserId ||
                            formatMessageTime(previousMessage.createdAt) !== formatMessageTime(message.createdAt)
                        return (
                            <div key={message.id} className={`chat-message-item group flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                                <div className="min-w-0 max-w-[70%] sm:max-w-[60%]">
                                    {showSenderName && (
                                        <div className="mb-1 px-1 text-xs font-medium text-sub">{message.senderUsername}</div>
                                    )}
                                    <div
                                        className={`break-words px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] ${
                                            mine
                                                ? 'bg-brand text-on-brand rounded-2xl rounded-tr-sm'
                                                : 'bg-surface text-ink rounded-2xl rounded-tl-sm'
                                        }`}
                                        onContextMenu={(event) => {
                                            if (!canModify) return
                                            event.preventDefault()
                                            openMessageMenu(message, event.currentTarget, {
                                                x: event.clientX,
                                                y: event.clientY,
                                            })
                                        }}
                                    >
                                        <span className={message.status === 'DELETED' ? 'text-sub/70' : undefined}>
                                            {messageDisplayText(message)}
                                        </span>
                                        {message.status === 'EDITED' && (
                                            <span className="ml-1.5 text-micro opacity-70">(수정됨)</span>
                                        )}
                                    </div>
                                </div>
                                {canModify && (
                                    <button
                                        type="button"
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted opacity-70 hover:bg-surface hover:text-ink hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand"
                                        aria-label="메시지 메뉴"
                                        aria-haspopup="menu"
                                        aria-controls="message-context-menu"
                                        aria-expanded={contextMenu?.message.id === message.id}
                                        onClick={(event) => openMessageMenu(message, event.currentTarget)}
                                    >
                                        <FiMoreVertical size={17} aria-hidden="true" />
                                    </button>
                                )}
                                {showMessageTime && (
                                    <span className={`mb-1 whitespace-nowrap text-xs text-sub ${mine ? 'order-first' : ''}`}>
                                        {formatMessageTime(message.createdAt)}
                                    </span>
                                )}
                            </div>
                        )
                            })}
                            {partnerIsTyping && (
                                <div className="flex justify-start" role="status" aria-live="polite">
                                    <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-xs text-sub">
                                        <span className="w-1.5 h-1.5 rounded-full bg-sub animate-pulse" />
                                        {typingMemberNames.join(', ')} 입력 중이에요
                                    </div>
                                </div>
                            )}
                            </>
                        )}
                    </div>
                </div>
                )}

                {chatError && (
                    <div className="border-t border-line bg-panel-subtle px-6 py-2 text-xs text-danger" role="alert">
                        {chatError}
                    </div>
                )}
                {rateLimitRemainingSeconds > 0 && (
                    <div
                        id="message-rate-limit-status"
                        className="border-t border-line bg-panel-subtle px-6 py-2 text-xs text-danger"
                    >
                        {rateLimitMessage} {rateLimitRemainingSeconds}초 후 다시 보낼 수 있어요.
                    </div>
                )}
                <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {rateLimitAnnouncement}
                </div>
                <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {messageAnnouncement}
                </div>
                <div className="p-4 border-t border-line">
                    <div className="relative">
                        <label htmlFor="message-input" className="sr-only">메시지 입력</label>
                        <input
                            id="message-input"
                            name="message"
                            autoComplete="off"
                            className="h-12 w-full rounded-full bg-surface pl-5 pr-14 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/25"
                            placeholder="메시지를 입력하세요…"
                            value={input}
                            onChange={handleInputChange}
                            onCompositionStart={handleInputCompositionStart}
                            onCompositionUpdate={handleInputCompositionUpdate}
                            onBlur={stopTyping}
                            aria-describedby={rateLimitRemainingSeconds > 0 ? 'message-rate-limit-status' : undefined}
                            onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing) return
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void handleSend()
                                }
                            }}
                        />
                        <button
                            className="absolute right-0.5 top-0.5 h-11 w-11 rounded-full bg-brand text-on-brand flex items-center justify-center hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleSend()}
                            disabled={!selectedRoom || !input.trim() || rateLimitRemainingSeconds > 0}
                            aria-label={rateLimitRemainingSeconds > 0
                                ? `메시지 보내기 (${rateLimitRemainingSeconds}초 후 가능)`
                                : '메시지 보내기'}
                        >
                            <SendIcon size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {isCreateRoomOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
                    <div ref={createRoomDialogRef} tabIndex={-1} className="max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-lg bg-panel p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="create-room-title">
                        <h2 id="create-room-title" className="text-base font-bold text-ink">새 대화</h2>
                        <label htmlFor="new-room-title" className="sr-only">대화방 이름</label>
                        <input
                            id="new-room-title"
                            name="roomTitle"
                            autoComplete="off"
                            className="mt-4 h-10 w-full rounded-md border border-line bg-panel px-3 text-sm text-ink outline-none focus:border-brand"
                            placeholder="예: 콘서트 이야기방…"
                            value={newRoomTitle}
                            onChange={(event) => setNewRoomTitle(event.target.value)}
                        />
                        <label htmlFor="new-room-members" className="sr-only">초대할 사용자명</label>
                        <input
                            id="new-room-members"
                            name="memberUsernames"
                            autoComplete="off"
                            spellCheck={false}
                            data-dialog-initial-focus
                            className="mt-3 h-10 w-full rounded-md border border-line bg-panel px-3 text-sm text-ink outline-none focus:border-brand"
                            placeholder="예: user1, user2…"
                            value={newRoomMemberNames}
                            onChange={(event) => setNewRoomMemberNames(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') void handleCreateRoom()
                                if (event.key === 'Escape') setIsCreateRoomOpen(false)
                            }}
                        />
                        {myFriendsQuery.isLoading ? (
                            <ChatFriendListSkeleton />
                        ) : inviteSuggestions.length > 0 ? (
                            <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-line bg-panel">
                                {inviteSuggestions.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-surface"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => handleSelectInviteUsername(item.username)}
                                    >
                                        <ChatAvatar
                                            imageKey={item.profileImageUrl}
                                            alt={`${item.username} 프로필`}
                                            className="h-7 w-7 shrink-0"
                                        />
                                        <span className="truncate">{item.username}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <p className="mt-2 text-xs text-sub">친구인 사용자만 초대할 수 있어요.</p>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                className="h-9 rounded-md px-3 text-sm text-sub hover:bg-surface"
                                onClick={() => setIsCreateRoomOpen(false)}
                                disabled={isCreatingRoom}
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-on-brand disabled:opacity-50"
                                onClick={() => void handleCreateRoom()}
                                disabled={isCreatingRoom || !newRoomMemberNames.trim()}
                            >
                                만들기
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isAddMemberOpen && selectedRoom && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
                    <div ref={addMemberDialogRef} tabIndex={-1} className="max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-lg bg-panel p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="add-member-title">
                        <h2 id="add-member-title" className="text-base font-bold text-ink">멤버 추가</h2>
                        <label htmlFor="add-room-members" className="sr-only">추가할 사용자명</label>
                        <input
                            id="add-room-members"
                            name="memberUsernames"
                            autoComplete="off"
                            spellCheck={false}
                            data-dialog-initial-focus
                            className="mt-4 h-10 w-full rounded-md border border-line bg-panel px-3 text-sm text-ink outline-none focus:border-brand"
                            placeholder="예: user1, user2…"
                            value={addMemberNames}
                            onChange={(event) => setAddMemberNames(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') void handleAddMembers()
                                if (event.key === 'Escape') setIsAddMemberOpen(false)
                            }}
                        />
                        {myFriendsQuery.isLoading ? (
                            <ChatFriendListSkeleton />
                        ) : addMemberSuggestions.length > 0 ? (
                            <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-line bg-panel">
                                {addMemberSuggestions.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-surface"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => handleSelectAddMemberUsername(item.username)}
                                    >
                                        <ChatAvatar
                                            imageKey={item.profileImageUrl}
                                            alt={`${item.username} 프로필`}
                                            className="h-7 w-7 shrink-0"
                                        />
                                        <span className="truncate">{item.username}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <p className="mt-2 text-xs text-sub">친구인 사용자만 초대할 수 있어요.</p>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                className="h-9 rounded-md px-3 text-sm text-sub hover:bg-surface"
                                onClick={() => setIsAddMemberOpen(false)}
                                disabled={isAddingMember}
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-on-brand disabled:opacity-50"
                                onClick={() => void handleAddMembers()}
                                disabled={isAddingMember || !addMemberNames.trim()}
                            >
                                추가
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {leaveRoomTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
                    <div ref={leaveRoomDialogRef} tabIndex={-1} className="max-h-[90dvh] w-full max-w-sm overflow-y-auto overscroll-contain rounded-lg bg-panel p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="leave-room-title">
                        <h2 id="leave-room-title" className="text-base font-bold text-ink">채팅방 나가기</h2>
                        <p className="mt-2 text-sm text-sub">
                            {getRoomDisplayName(leaveRoomTarget, myProfileQuery.data?.userId)} 대화방에서 나갈까요? 대화 목록에서 사라져요.
                        </p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                data-dialog-initial-focus
                                className="h-9 rounded-md px-3 text-sm text-sub hover:bg-surface"
                                onClick={() => setLeaveRoomTarget(null)}
                                disabled={isLeavingRoom}
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                className="h-9 rounded-md bg-danger px-3 text-sm font-medium text-on-danger disabled:opacity-50"
                                onClick={() => void handleLeaveRoom()}
                                disabled={isLeavingRoom}
                            >
                                나가기
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {contextMenu && (
                <div
                    id="message-context-menu"
                    ref={contextMenuRef}
                    role="menu"
                    aria-label="메시지 작업"
                    className="fixed z-50 w-40 rounded-lg border border-line bg-panel p-1 shadow-lg"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={handleMessageMenuKeyDown}
                    onBlur={handleMessageMenuBlur}
                >
                    <button
                        type="button"
                        role="menuitem"
                        className="flex h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-ink hover:bg-surface"
                        onClick={() => {
                            contextMenu.trigger?.focus({ preventScroll: true })
                            setEditingMessage(contextMenu.message)
                            setEditText(contextMenu.message.content)
                            setContextMenu(null)
                        }}
                    >
                        <FiEdit2 size={15} aria-hidden="true" />
                        수정
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="flex h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-danger hover:bg-panel-subtle"
                        onClick={() => {
                            contextMenu.trigger?.focus({ preventScroll: true })
                            setDeleteTarget(contextMenu.message)
                            setContextMenu(null)
                        }}
                    >
                        <FiTrash2 size={15} aria-hidden="true" />
                        삭제
                    </button>
                </div>
            )}

            {roomContextMenu && (
                <div
                    role="menu"
                    className="fixed z-50 w-40 rounded-lg border border-line bg-panel p-1 shadow-lg"
                    style={{ left: roomContextMenu.x, top: roomContextMenu.y }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        role="menuitem"
                        className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-danger hover:bg-panel-subtle"
                        onClick={() => {
                            setLeaveRoomTarget(roomContextMenu.room)
                            setRoomContextMenu(null)
                        }}
                    >
                        <FiLogOut size={15} aria-hidden="true" />
                        채팅방 나가기
                    </button>
                </div>
            )}

            {editingMessage && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
                    <div ref={editMessageDialogRef} tabIndex={-1} className="max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-lg bg-panel p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="edit-message-title">
                        <h2 id="edit-message-title" className="text-base font-bold text-ink">메시지 수정</h2>
                        <label htmlFor="edit-message-content" className="sr-only">메시지 내용</label>
                        <textarea
                            id="edit-message-content"
                            name="messageContent"
                            autoComplete="off"
                            data-dialog-initial-focus
                            className="mt-4 min-h-28 w-full resize-y rounded-lg border border-line bg-panel p-3 text-sm text-ink outline-none focus:border-brand"
                            value={editText}
                            onChange={(event) => setEditText(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') setEditingMessage(null)
                            }}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                className="h-9 rounded-md px-3 text-sm text-sub hover:bg-surface"
                                onClick={() => setEditingMessage(null)}
                                disabled={messageActionLoading}
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-on-brand disabled:opacity-50"
                                onClick={() => void handleEditMessage()}
                                disabled={messageActionLoading || !editText.trim()}
                            >
                                수정
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
                    <div ref={deleteMessageDialogRef} tabIndex={-1} className="max-h-[90dvh] w-full max-w-sm overflow-y-auto overscroll-contain rounded-lg bg-panel p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="delete-message-title">
                        <h2 id="delete-message-title" className="text-base font-bold text-ink">메시지 삭제</h2>
                        <p className="mt-2 text-sm text-sub">삭제한 메시지는 복구할 수 없어요.</p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                data-dialog-initial-focus
                                className="h-9 rounded-md px-3 text-sm text-sub hover:bg-surface"
                                onClick={() => setDeleteTarget(null)}
                                disabled={messageActionLoading}
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                className="h-9 rounded-md bg-danger px-3 text-sm font-medium text-on-danger disabled:opacity-50"
                                onClick={() => void handleDeleteMessage()}
                                disabled={messageActionLoading}
                            >
                                삭제
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default MessagePage
