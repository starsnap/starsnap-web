// Run: node --test src/services/chat/chatHistory.test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function compile(source, env = {}) {
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    const exports = {}
    return new Function('env', 'exports', `with (env) { ${output}; return exports; }`)(env, exports)
}

const history = compile(fs.readFileSync(path.join(__dirname, 'chatHistory.ts'), 'utf8'))
const pageSource = fs.readFileSync(path.join(__dirname, '../../pages/main/MessagePage.tsx'), 'utf8')
const pageAST = ts.createSourceFile('MessagePage.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function pageFunction(name, env) {
    let initializer
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(pageAST) === name) initializer = node.initializer
        ts.forEachChild(node, visit)
    }
    visit(pageAST)
    assert.ok(initializer, `Actual MessagePage function ${name} must exist`)
    return compile(`export const subject = ${initializer.getText(pageAST)}`, env).subject
}

const message = (id, content = id, status = 'NORMAL') => ({
    id, content, status, roomId: 'a', senderUserId: 'user', senderUsername: 'user', createdAt: id.padStart(4, '0'),
})
const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}
function harness(fetch, messages = []) {
    const env = { ...history, getChatHistory: fetch, console: { error() {} }, window: { requestAnimationFrame: (fn) => fn() } }
    const refs = {
        messagesRef: messages, selectedRoomRef: { roomId: 'a' }, historyGenerationRef: 0,
        historyRequestActiveRef: false, hasLoadedHistoryRef: messages.length > 0,
        historyCursorRef: null, messageChangeVersionRef: 0, messageChangesRef: new Map(),
        isLoadingOlderMessagesRef: false, messageScrollRef: null, shouldAutoScrollRef: true,
        standaloneRoomListRequestedRef: false,
    }
    for (const [key, current] of Object.entries(refs)) env[key] = { current }
    for (const name of ['setMessagesState', 'setOlderMessagesLoading', 'setHistoryLoading', 'setChatError', 'setSelectedRoom']) {
        env[name] = (value) => { env[name + 'Value'] = typeof value === 'function' ? value(env[name + 'Value']) : value }
    }
    env.setMessages = pageFunction('setMessages', env)
    env.applyMessageChange = pageFunction('applyMessageChange', env)
    env.refreshHistory = pageFunction('refreshHistory', env)
    env.selectRoom = pageFunction('selectRoom', env)
    env.loadOlderMessages = pageFunction('loadOlderMessages', env)
    return env
}

test('delayed initial history retains create, edit and deletion before the message is loaded', async () => {
    const response = deferred()
    const state = harness(() => response.promise)
    const pending = state.refreshHistory()
    state.applyMessageChange(message('3', 'live'))
    state.applyMessageChange(message('1', 'edited', 'EDITED'))
    state.applyMessageChange({ id: '2', status: 'DELETED', content: '' })
    response.resolve({ messages: [message('1'), message('2')], hasMore: false })
    await pending
    assert.deepEqual(state.messagesRef.current.map(({ id, content, status }) => ({ id, content, status })), [
        { id: '1', content: 'edited', status: 'EDITED' },
        { id: '2', content: '', status: 'DELETED' },
        { id: '3', content: 'live', status: 'NORMAL' },
    ])
    assert.equal(state.historyRequestActiveRef.current, false)
})

test('reconnect loads every page through the oldest displayed item and keeps sorted unique messages', async () => {
    const cursors = []
    const state = harness(async (_, before) => {
        cursors.push(before)
        return before === undefined
            ? { messages: [message('5'), message('6')], hasMore: true }
            : before === '5'
                ? { messages: [message('3'), message('4')], hasMore: true }
                : { messages: [message('1', 'server edit', 'EDITED'), message('2')], hasMore: true }
    }, [message('1'), message('2')])
    await state.refreshHistory()
    assert.deepEqual(cursors, [undefined, '5', '3'])
    assert.deepEqual(state.messagesRef.current.map(({ id }) => id), ['1', '2', '3', '4', '5', '6'])
    assert.equal(state.messagesRef.current[0].content, 'server edit')
    assert.equal(state.historyCursorRef.current, '1')
})

test('switching away and back rejects an older request even when the room ID matches again', async () => {
    const response = deferred()
    const state = harness(() => response.promise)
    const pending = state.refreshHistory()
    state.selectRoom({ roomId: 'b' })
    state.selectRoom({ roomId: 'a' })
    state.getChatHistory = async () => ({ messages: [message('2')], hasMore: false })
    await state.refreshHistory()
    response.resolve({ messages: [message('1')], hasMore: false })
    await pending
    assert.deepEqual(state.messagesRef.current.map(({ id }) => id), ['2'])
    assert.equal(state.historyRequestActiveRef.current, false)
    assert.equal(state.setHistoryLoadingValue, false)
})

test('failed reload preserves displayed history and clears only its own loading state', async () => {
    const response = deferred()
    const state = harness(() => response.promise, [message('1')])
    const pending = state.refreshHistory()
    response.reject(new Error('offline'))
    await pending
    assert.deepEqual(state.messagesRef.current.map(({ id }) => id), ['1'])
    assert.equal(state.historyRequestActiveRef.current, false)
    assert.equal(state.setHistoryLoadingValue, false)
    assert.match(state.setChatErrorValue, /메시지를 불러오지/)
    state.getChatHistory = async () => ({ messages: [message('1')], hasMore: false })
    await state.refreshHistory()
    assert.equal(state.setChatErrorValue, null)
})

test('stale failure does not overwrite errors or loading of a new request', async () => {
    const old = deferred(), current = deferred()
    const state = harness(() => old.promise)
    const first = state.refreshHistory()
    state.getChatHistory = () => current.promise
    const second = state.refreshHistory()
    old.reject(new Error('stale'))
    await first
    assert.equal(state.historyRequestActiveRef.current, true)
    assert.equal(state.setChatErrorValue, undefined)
    current.resolve({ messages: [], hasMore: false })
    await second
    assert.equal(state.historyRequestActiveRef.current, false)
})

test('older pagination applies unknown deletion tombstones and ignores a later room switch', async () => {
    const response = deferred()
    const state = harness(() => response.promise, [message('3')])
    state.historyCursorRef.current = '3'
    const pending = state.loadOlderMessages()
    state.applyMessageChange({ id: '1', status: 'DELETED', content: '' })
    response.resolve({ messages: [message('1'), message('2')], hasMore: false })
    await pending
    assert.equal(state.messagesRef.current[0].status, 'DELETED')
    const late = deferred()
    state.getChatHistory = () => late.promise
    state.historyCursorRef.current = '1'
    const older = state.loadOlderMessages()
    state.selectRoom({ roomId: 'b' })
    late.resolve({ messages: [message('0')], hasMore: false })
    await older
    assert.deepEqual(state.messagesRef.current, [])
})

test('repeated replay cursor fails rather than requesting pages forever', async () => {
    await assert.rejects(history.loadChatHistory(
        async () => ({ messages: [message('2')], hasMore: true }), '1', () => true,
    ), /커서가 반복/)
})
