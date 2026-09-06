import type { ChatMessage, ChatMessageHistoryPage } from './chatService'

export type ChatMessageChange = Partial<ChatMessage> & Pick<ChatMessage, 'id'>

export function mergeChatHistory(
    history: ChatMessage[],
    current: ChatMessage[],
    changes: ChatMessageChange[],
): ChatMessage[] {
    const merged = new Map(current.map((message) => [message.id, message]))
    history.forEach((message) => merged.set(message.id, message))
    changes.forEach((change) => {
        const message = merged.get(change.id)
        if (message) merged.set(change.id, { ...message, ...change })
    })
    return [...merged.values()].sort((a, b) => (
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    ))
}

/** Fetch through the oldest displayed message so reconnects cannot leave page-sized gaps. */
export async function loadChatHistory(
    fetchPage: (beforeMessageId?: string) => Promise<ChatMessageHistoryPage>,
    oldestKnownId: string | undefined,
    isCurrent: () => boolean,
): Promise<ChatMessageHistoryPage | null> {
    const messages: ChatMessage[] = []
    const cursors = new Set<string>()
    let beforeMessageId: string | undefined
    while (isCurrent()) {
        const page = await fetchPage(beforeMessageId)
        if (!isCurrent()) return null
        messages.unshift(...page.messages)
        const nextCursor = page.messages[0]?.id
        if (!oldestKnownId || !page.hasMore || !nextCursor || page.messages.some((message) => message.id === oldestKnownId)) {
            return { messages, hasMore: page.hasMore && !!nextCursor }
        }
        if (cursors.has(nextCursor)) throw new Error('채팅 이력 커서가 반복되었습니다.')
        cursors.add(nextCursor)
        beforeMessageId = nextCursor
    }
    return null
}
