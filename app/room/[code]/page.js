'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

const ALL_PAIRS = [
  ['Lion','Tigre'],['Plage','Désert'],['Pizza','Tarte'],
  ['Avion','Fusée'],['Guitare','Violon'],['Château','Palais'],
  ['Requin','Dauphin'],['Forêt','Jungle'],['Banane','Mangue'],
  ['Football','Rugby'],['Hiver','Automne'],['Lune','Soleil'],
  ['Policier','Pompier'],['Cinéma','Théâtre'],['Montagne','Volcan'],
  ['Voiture','Moto'],['Chien','Chat'],['Roi','Président'],
  ['Épée','Lance'],['Café','Thé'],['Tigre','Léopard'],
  ['Piscine','Lac'],['Bus','Tramway'],['Crayon','Stylo'],
  ['Boulanger','Cuisinier'],['Rivière','Fleuve'],['Glace','Neige'],
  ['Soldat','Chevalier'],['Hibou','Aigle'],['Rose','Tulipe'],
  ['Tambour','Guitare'],['Manteau','Veste'],['Château','Manoir'],
  ['Éléphant','Rhinocéros'],['Sorcier','Magicien'],['Bateau','Navire'],
]

function pickFreshPair(usedPairs = []) {
  const available = ALL_PAIRS.filter(p => !usedPairs.includes(p[0] + '|' + p[1]))
  if (available.length === 0) return ALL_PAIRS[Math.floor(Math.random() * ALL_PAIRS.length)]
  return available[Math.floor(Math.random() * available.length)]
}

export default function Room() {
  const { code } = useParams()
  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [myIndex, setMyIndex] = useState(null)
  const [wordInput, setWordInput] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [status, setStatus] = useState('Chargement...')

  useEffect(() => {
    if (!code) return
    const params = new URLSearchParams(window.location.search)
    const idx = params.get('p') !== null
      ? parseInt(params.get('p'))
      : parseInt(localStorage.getItem('nexus_index') || '0')
    setMyIndex(idx)
    localStorage.setItem('nexus_index', String(idx))

    async function load() {
      const { data: r, error: re } = await supabase.from('rooms').select('*').eq('id', code).single()
      const { data: p, error: pe } = await supabase.from('players').select('*').eq('room_id', code).order('player_index')
      if (re) { setStatus('Erreur room: ' + re.message); return }
      if (pe) { setStatus('Erreur players: ' + pe.message); return }
      if (r) setRoom(prev => {
        if (prev && prev.phase !== r.phase) { setRevealed(false); setWordInput('') }
        return r
      })
      if (p) setPlayers(p)
      setStatus('OK')
    }
    load()
    const poll = setInterval(load, 2000)
    const channel = supabase.channel('room-' + code)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${code}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${code}` }, load)
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [code])

  async function startGame() {
    await supabase.from('rooms').update({ phase: 'reveal', current_player: 0 }).eq('id', code)
  }

  async function confirmRevealed() {
    setRevealed(true)
    const me = players.find(p => p.player_index === myIndex)
    if (me) await supabase.from('players').update({ ready: true }).eq('id', me.id)
  }

  async function startPlay() {
    await supabase.from('rooms').update({ phase: 'play', current_round: 0, current_player: 0 }).eq('id', code)
  }

  async function submitWord() {
    if (!wordInput.trim()) return
    const me = players.find(p => p.player_index === myIndex)
    if (!me) return
    const newWords = [...(me.words || []), wordInput.trim().toLowerCase()]
    await supabase.from('players').update({ words: newWords }).eq('id', me.id)
    const maxP = room.max_players || players.length
    const wordsPerPlayer = room.words_per_player || room.total_rounds || 3
    let nextPlayer = room.current_player + 1
    let nextRound = room.current_round
    if (nextPlayer >= maxP) { nextPlayer = 0; nextRound++ }
    if (nextRound >= wordsPerPlayer) {
      await supabase.from('rooms').update({ phase: 'vote', votes: {} }).eq('id', code)
    } else {
      await supabase.from('rooms').update({ current_player: nextPlayer, current_round: nextRound }).eq('id', code)
    }
    setWordInput('')
  }

  async function vote(targetIndex) {
    const currentVotes = room.votes || {}
    const newVotes = { ...currentVotes, [String(myIndex)]: targetIndex }
    await supabase.from('rooms').update({ votes: newVotes }).eq('id', code)

    if (Object.keys(newVotes).length >= players.length) {
      const count = {}
      Object.values(newVotes).forEach(v => { count[v] = (count[v] || 0) + 1 })
      const eliminated = parseInt(Object.entries(count).sort((a, b) => b[1] - a[1])[0][0])
      const spyWon = eliminated !== room.spy_index
      const newScores = { ...(room.scores || {}) }
      players.forEach((_, i) => {
        const prev = parseInt(newScores[String(i)] || 0)
        if (!spyWon && i !== room.spy_index) newScores[String(i)] = prev + 2
        if (spyWon && i === room.spy_index) newScores[String(i)] = prev + 3
      })
      const mancheNumber = room.manche_number || 1
      const winMode = room.win_mode || 'manches'
      const targetManches = room.target_manches || 5
      const targetScore = room.target_score || 10
      let sessionOver = false
      if (winMode === 'manches' && mancheNumber >= targetManches) sessionOver = true
      if (winMode === 'score') {
        const maxScore = Math.max(...Object.values(newScores).map(s => parseInt(s) || 0))
        if (maxScore >= targetScore) sessionOver = true
      }
      await supabase.from('rooms').update({
        phase: spyWon ? 'spy_wins' : 'citizens_win',
        scores: newScores,
        manche_number: mancheNumber + 1,
        session_over: sessionOver,
      }).eq('id', code)
    }
  }

  async function playAgain() {
    const maxP = room.max_players || players.length
    const usedPairs = room.used_pairs || []
    const pair = pickFreshPair(usedPairs)
    const newUsed = [...usedPairs, pair[0] + '|' + pair[1]]
    const seed = Date.now()
    let newSpyIndex = seed % maxP
    if (maxP > 1 && newSpyIndex === room.spy_index) newSpyIndex = (newSpyIndex + 1) % maxP
    for (const p of players) {
      await supabase.from('players').update({ words: [], ready: false }).eq('id', p.id)
    }
    await supabase.from('rooms').update({
      citizen_word: pair[0], spy_word: pair[1], spy_index: newSpyIndex,
      current_round: 0, current_player: 0, phase: 'lobby', votes: {},
      used_pairs: newUsed,
    }).eq('id', code)
    setRevealed(false)
  }

  async function endSession() {
    const newScores = {}
    players.forEach((_, i) => { newScores[String(i)] = 0 })
    const pair = pickFreshPair([])
    const maxP = room.max_players || players.length
    let newSpyIndex = Date.now() % maxP
    if (maxP > 1 && newSpyIndex === room.spy_index) newSpyIndex = (newSpyIndex + 1) % maxP
    for (const p of players) {
      await supabase.from('players').update({ words: [], ready: false }).eq('id', p.id)
    }
    await supabase.from('rooms').update({
      citizen_word: pair[0], spy_word: pair[1], spy_index: newSpyIndex,
      current_round: 0, current_player: 0, phase: 'lobby',
      votes: {}, scores: newScores, manche_number: 1, session_over: false,
      used_pairs: [pair[0] + '|' + pair[1]],
    }).eq('id', code)
    setRevealed(false)
  }

  if (!room || myIndex === null) return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={{ textAlign: 'center', color: '#6b7390', marginBottom: '12px' }}>Chargement...</div>
        <div style={{ background: '#f0f2f8', borderRadius: '8px', padding: '10px', fontSize: '12px', fontFamily: 'monospace', color: '#4a5270' }}>{status}</div>
      </div>
    </main>
  )

  const maxPlayers = room.max_players || players.length
  const wordsPerPlayer = room.words_per_player || room.total_rounds || 3
  const isMyTurn = room.phase === 'play' && room.current_player === myIndex
  const isSpy = myIndex === room.spy_index
  const spyMode = room.spy_mode || 'knows'
  // Mode aveugle : l'imposteur ne sait pas qu'il l'est
  const showSpyLabel = isSpy && spyMode === 'knows'
  const myWord = isSpy ? room.spy_word : room.citizen_word
  const allReady = players.length >= maxPlayers && players.every(p => p.ready)
  const myVote = room.votes ? room.votes[String(myIndex)] : undefined
  const voteCount = {}
  Object.values(room.votes || {}).forEach(v => { voteCount[v] = (voteCount[v] || 0) + 1 })
  const totalVotes = Object.keys(room.votes || {}).length
  const scores = room.scores || {}
  const winMode = room.win_mode || 'manches'
  const targetManches = room.target_manches || 5
  const targetScore = room.target_score || 10
  const mancheNumber = room.manche_number || 1
  const sessionOver = room.session_over || false

  const Bar = () => (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0f1629', padding: '5px 12px', fontSize: '10px', fontFamily: 'monospace', color: '#0d7a4e', zIndex: 9999, display: 'flex', gap: '12px' }}>
      <span>idx:{myIndex}</span><span>phase:{room.phase}</span>
      <span>joueurs:{players.length}/{maxPlayers}</span><span>manche:{mancheNumber}</span>
      <span style={{ color: '#6b7390' }}>{status}</span>
    </div>
  )

  const SessionProgress = () => {
    if (winMode === 'manches') {
      const done = Math.min(mancheNumber - 1, targetManches)
      return (
        <div style={{ background: 'white', border: '1px solid #e2e5ef', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#6b7390', whiteSpace: 'nowrap', fontWeight: '500' }}>Manche {mancheNumber}/{targetManches}</span>
          <div style={{ flex: 1, background: '#f0f2f8', borderRadius: '20px', height: '5px' }}>
            <div style={{ background: '#1a56f0', borderRadius: '20px', height: '5px', width: `${(done / targetManches) * 100}%`, transition: 'width .3s' }} />
          </div>
        </div>
      )
    }
    const maxScore = Math.max(...Object.values(scores).map(s => parseInt(s) || 0), 0)
    return (
      <div style={{ background: 'white', border: '1px solid #e2e5ef', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', color: '#6b7390', whiteSpace: 'nowrap', fontWeight: '500' }}>Score {maxScore}/{targetScore}</span>
        <div style={{ flex: 1, background: '#f0f2f8', borderRadius: '20px', height: '5px' }}>
          <div style={{ background: '#1a56f0', borderRadius: '20px', height: '5px', width: `${Math.min((maxScore / targetScore) * 100, 100)}%`, transition: 'width .3s' }} />
        </div>
      </div>
    )
  }

  // ——— LOBBY ———
  if (room.phase === 'lobby') return (
    <main style={S.page}>
      <Bar />
      <div style={S.card}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <p style={S.sublabel}>CODE DE LA SALLE</p>
          <div style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '8px', color: '#1a56f0', margin: '8px 0' }}>{code}</div>
          <p style={{ fontSize: '13px', color: '#6b7390' }}>{players.length}/{maxPlayers} joueurs connectés</p>
        </div>
        <div style={{ background: '#f0f2f8', borderRadius: '20px', height: '5px', marginBottom: '16px' }}>
          <div style={{ background: '#1a56f0', borderRadius: '20px', height: '5px', width: `${(players.length / maxPlayers) * 100}%`, transition: 'width .3s' }} />
        </div>
        <div style={{ background: '#f7f8fc', borderRadius: '8px', padding: '8px 14px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7390' }}>
          <span>Manche {mancheNumber}{winMode === 'manches' ? `/${targetManches}` : ''}</span>
          <span>{winMode === 'score' ? `Objectif : ${targetScore} pts` : `${targetManches} manches`} · {wordsPerPlayer} indices/joueur</span>
        </div>
        <div style={{ marginBottom: '16px' }}>
          {players.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#f7f8fc', borderRadius: '8px', marginBottom: '6px' }}>
              <div style={av(i)}>{p.name[0].toUpperCase()}</div>
              <span style={{ fontWeight: '500', flex: 1, color: '#0f1629' }}>{p.name}</span>
              {parseInt(scores[String(i)] || 0) > 0 && <span style={{ fontSize: '13px', color: '#1a56f0', fontWeight: '700' }}>{scores[String(i)]} pts</span>}
              {i === 0 && <span style={{ fontSize: '11px', color: '#1a56f0', fontWeight: '600', letterSpacing: '1px' }}>HÔTE</span>}
              {i === myIndex && i !== 0 && <span style={{ fontSize: '11px', color: '#6b7390' }}>moi</span>}
            </div>
          ))}
          {Array.from({ length: Math.max(0, maxPlayers - players.length) }, (_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#f7f8fc', borderRadius: '8px', marginBottom: '6px', opacity: .4 }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '2px dashed #cdd1e0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9aa0b8" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </div>
              <span style={{ fontSize: '13px', color: '#9aa0b8' }}>En attente...</span>
            </div>
          ))}
        </div>
        {myIndex === 0 && players.length >= maxPlayers
          ? <button onClick={startGame} style={{ ...S.btnPrimary, width: '100%' }}>Lancer la manche →</button>
          : <div style={S.waiting}>{myIndex === 0 ? `En attente (${players.length}/${maxPlayers})` : "En attente que l'hôte lance"}</div>}
      </div>
    </main>
  )

  // ——— REVEAL ———
  if (room.phase === 'reveal') return (
    <main style={S.page}>
      <Bar />
      <div style={S.card}>
        <div style={{ textAlign: 'center' }}>
          {/* Mode knows : badge imposteur visible. Mode blind : tout le monde voit "Citoyen·ne" */}
          <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '600', background: showSpyLabel ? '#fcebeb' : '#e8effe', color: showSpyLabel ? '#a32d2d' : '#0e3fc2', marginBottom: '20px' }}>
            {showSpyLabel ? "Tu es l'imposteur" : "Tu es citoyen·ne"}
          </span>
          {!revealed ? (
            <>
              <p style={{ fontSize: '14px', color: '#6b7390', lineHeight: '1.6', marginBottom: '24px' }}>
                Assure-toi que <strong style={{ color: '#0f1629' }}>personne ne voit ton écran</strong>.
              </p>
              <button onClick={confirmRevealed} style={{ ...S.btnPrimary, width: '100%' }}>Voir mon mot secret</button>
            </>
          ) : (
            <>
              <p style={{ fontSize: '12px', color: '#9aa0b8', marginBottom: '4px' }}>
                {showSpyLabel ? 'Ton mot (différent des autres) :' : 'Ton mot secret :'}
              </p>
              <div style={{ fontSize: '52px', fontWeight: '700', letterSpacing: '-2px', margin: '10px 0', color: '#0f1629' }}>{myWord}</div>
              <p style={{ fontSize: '13px', color: '#6b7390', marginBottom: '24px' }}>
                {showSpyLabel
                  ? 'Bluff ! Donne des mots cohérents avec les autres.'
                  : isSpy && spyMode === 'blind'
                    ? 'Décris ce mot sans le dire.'
                    : 'Ne le dis jamais !'}
              </p>
              <div style={{ background: '#f7f8fc', borderRadius: '8px', padding: '12px', marginBottom: '16px', textAlign: 'left' }}>
                <p style={{ ...S.sublabel, marginBottom: '8px' }}>Prêts</p>
                {players.map((p, i) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.ready ? '#0d7a4e' : '#e2e5ef', flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: p.ready ? '#0f1629' : '#9aa0b8' }}>{p.name}{i === myIndex ? ' (moi)' : ''}</span>
                    {p.ready && <span style={{ fontSize: '11px', color: '#0d7a4e', marginLeft: 'auto' }}>✓</span>}
                  </div>
                ))}
              </div>
              {myIndex === 0
                ? allReady
                  ? <button onClick={startPlay} style={{ ...S.btnPrimary, width: '100%' }}>Tout le monde est prêt →</button>
                  : <div style={S.waiting}>En attente ({players.filter(p => p.ready).length}/{maxPlayers})</div>
                : <div style={S.waiting}>En attente que l'hôte lance...</div>}
            </>
          )}
        </div>
      </div>
    </main>
  )

  // ——— PLAY ———
  if (room.phase === 'play') return (
    <main style={{ minHeight: '100vh', background: '#f7f8fc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px 60px' }}>
      <Bar />
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <SessionProgress />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', color: '#6b7390', fontWeight: '500' }}>
            Indice {room.current_round + 1} / {wordsPerPlayer}
          </span>
          <span style={{ fontSize: '12px', background: showSpyLabel ? '#fcebeb' : '#e8effe', color: showSpyLabel ? '#a32d2d' : '#0e3fc2', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>
            {showSpyLabel ? 'Imposteur' : 'Citoyen·ne'}
          </span>
        </div>
        {isMyTurn ? (
          <div style={{ background: '#e8effe', border: '1px solid rgba(26,86,240,.2)', borderRadius: '10px', padding: '14px', marginBottom: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: '#0e3fc2', fontWeight: '600', marginBottom: '4px' }}>C'est ton tour !</div>
            <div style={{ fontSize: '12px', color: '#6b7390' }}>Ton mot : <strong style={{ color: '#0f1629' }}>{myWord}</strong></div>
          </div>
        ) : (
          <div style={{ background: '#f7f8fc', border: '1px solid #e2e5ef', borderRadius: '10px', padding: '12px', marginBottom: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#6b7390' }}>
              En attente de <strong style={{ color: '#0f1629' }}>{players.find(p => p.player_index === room.current_player)?.name}</strong>...
            </div>
          </div>
        )}
        <div style={{ background: 'white', border: '1px solid #e2e5ef', borderRadius: '10px', padding: '14px', marginBottom: '12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 6px 8px', color: '#9aa0b8', fontWeight: '500', fontSize: '11px', borderBottom: '1px solid #f0f2f8' }}>Joueur</th>
                {Array.from({ length: wordsPerPlayer }, (_, r) => (
                  <th key={r} style={{ textAlign: 'center', padding: '4px 6px 8px', color: r === room.current_round ? '#1a56f0' : '#9aa0b8', fontWeight: '500', fontSize: '11px', borderBottom: '1px solid #f0f2f8' }}>
                    #{r + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => (
                <tr key={p.id} style={{ background: i === myIndex ? '#f7f9ff' : '' }}>
                  <td style={{ padding: '7px 6px', fontWeight: i === myIndex ? '600' : '400', color: '#0f1629' }}>
                    {p.name}{i === myIndex ? ' ✦' : ''}
                  </td>
                  {Array.from({ length: wordsPerPlayer }, (_, r) => (
                    <td key={r} style={{ textAlign: 'center', padding: '7px 6px' }}>
                      {p.words?.[r]
                        ? <span style={{ background: r === room.current_round ? '#e8effe' : '#f0f2f8', borderRadius: '20px', padding: '2px 10px', fontSize: '12px', color: r === room.current_round ? '#0e3fc2' : '#4a5270', fontWeight: '500' }}>{p.words[r]}</span>
                        : <span style={{ color: '#d0d4e0' }}>{r < room.current_round ? '—' : '·'}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isMyTurn && (
          <div style={{ background: 'white', border: '1px solid #e2e5ef', borderRadius: '10px', padding: '14px' }}>
            <div style={{ fontSize: '13px', color: '#6b7390', marginBottom: '10px' }}>
              Donne <strong style={{ color: '#0f1629' }}>1 mot</strong> qui évoque ton mot sans le dire :
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={wordInput} onChange={e => setWordInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitWord()}
                placeholder="Ton mot…" maxLength={20} autoFocus
                style={{ flex: 1, border: '1px solid #e2e5ef', borderRadius: '8px', padding: '10px 12px', fontSize: '15px', outline: 'none', color: '#0f1629', background: 'white', textTransform: 'lowercase' }} />
              <button onClick={submitWord} style={{ background: '#1a56f0', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>OK</button>
            </div>
          </div>
        )}
      </div>
    </main>
  )

  // ——— VOTE ———
  if (room.phase === 'vote') return (
    <main style={{ minHeight: '100vh', background: '#f7f8fc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px 60px' }}>
      <Bar />
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <SessionProgress />
        <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#0f1629', marginBottom: '4px' }}>Vote</h2>
        <p style={{ fontSize: '13px', color: '#6b7390', marginBottom: '10px' }}>
          {myVote !== undefined ? `Ton vote est enregistré — ${totalVotes}/${players.length}` : "Qui est l'imposteur ?"}
        </p>
        <div style={{ background: '#f0f2f8', borderRadius: '20px', height: '5px', marginBottom: '16px' }}>
          <div style={{ background: '#1a56f0', borderRadius: '20px', height: '5px', width: `${(totalVotes / players.length) * 100}%`, transition: 'width .3s' }} />
        </div>
        {players.map((p, i) => (
          <div key={p.id} style={{ background: 'white', border: myVote === i ? '1.5px solid #e02d2d' : '1px solid #e2e5ef', borderRadius: '10px', padding: '14px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={av(i)}>{p.name[0].toUpperCase()}</div>
              <span style={{ fontWeight: '500', color: '#0f1629', flex: 1 }}>{p.name}{i === myIndex ? ' (moi)' : ''}</span>
              {voteCount[i] > 0 && <span style={{ fontSize: '12px', background: '#fcebeb', color: '#a32d2d', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>{voteCount[i]} vote{voteCount[i] > 1 ? 's' : ''}</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: i !== myIndex && myVote === undefined ? '10px' : '0' }}>
              {(p.words || []).map((w, j) => <span key={j} style={{ background: '#f0f2f8', borderRadius: '20px', padding: '3px 10px', fontSize: '12px', color: '#4a5270', fontWeight: '500' }}>{w}</span>)}
            </div>
            {i !== myIndex && myVote === undefined && (
              <button onClick={() => vote(i)} style={{ width: '100%', background: '#e02d2d', color: 'white', border: 'none', borderRadius: '7px', padding: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginTop: '10px' }}>
                Voter contre {p.name}
              </button>
            )}
            {myVote === i && <div style={{ marginTop: '8px', fontSize: '12px', color: '#a32d2d', fontWeight: '500', textAlign: 'center' }}>✓ Tu as voté contre {p.name}</div>}
          </div>
        ))}
      </div>
    </main>
  )

  // ——— RÉSULTAT ———
  const win = room.phase === 'citizens_win'
  const sortedPlayers = [...players].sort((a, b) => (parseInt(scores[String(b.player_index)] || 0)) - (parseInt(scores[String(a.player_index)] || 0)))
  const sessionWinner = sessionOver ? sortedPlayers[0] : null

  return (
    <main style={{ minHeight: '100vh', background: '#f7f8fc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px 60px' }}>
      <Bar />
      <div style={{ width: '100%', maxWidth: '420px' }}>

        {sessionOver && (
          <div style={{ background: 'linear-gradient(135deg, #1a56f0, #0e3fc2)', borderRadius: '16px', padding: '28px 20px', textAlign: 'center', marginBottom: '16px', color: 'white' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', letterSpacing: '2px', opacity: .8, marginBottom: '8px', textTransform: 'uppercase' }}>Session terminée</div>
            <div style={{ fontSize: '28px', fontWeight: '700', marginBottom: '4px' }}>{sessionWinner?.name} gagne !</div>
            <div style={{ fontSize: '14px', opacity: .8 }}>{scores[String(sessionWinner?.player_index)] || 0} points au total</div>
          </div>
        )}

        <div style={{ ...S.card, textAlign: 'center', marginBottom: '12px' }}>
          <div style={{ marginBottom: '12px' }}>
            {win
              ? <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#0d7a4e" strokeWidth="1.5" style={{ margin: '0 auto', display: 'block' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              : <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#e02d2d" strokeWidth="1.5" style={{ margin: '0 auto', display: 'block' }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: '600', color: '#0f1629', marginBottom: '4px' }}>
            {win ? 'Les citoyens ont gagné !' : "L'imposteur a gagné !"}
          </h2>
          <p style={{ fontSize: '13px', color: '#6b7390', marginBottom: '14px' }}>
            {players.find(p => p.player_index === room.spy_index)?.name} était l'imposteur
          </p>
          <div style={{ display: 'flex', border: '1px solid #e2e5ef', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ flex: 1, padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#9aa0b8', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Citoyens</div>
              <div style={{ fontSize: '20px', fontWeight: '600', color: '#0f1629' }}>{room.citizen_word}</div>
            </div>
            <div style={{ flex: 1, padding: '12px', borderLeft: '1px solid #e2e5ef' }}>
              <div style={{ fontSize: '11px', color: '#9aa0b8', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '1px' }}>Imposteur</div>
              <div style={{ fontSize: '20px', fontWeight: '600', color: '#e02d2d' }}>{room.spy_word}</div>
            </div>
          </div>
        </div>

        <div style={{ ...S.card, marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <p style={S.sublabel}>Scores</p>
            <span style={{ fontSize: '12px', color: '#6b7390' }}>
              {winMode === 'manches' ? `Manche ${mancheNumber - 1}/${targetManches}` : `Objectif : ${targetScore} pts`}
            </span>
          </div>
          {sortedPlayers.map((p, rank) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: rank < sortedPlayers.length - 1 ? '1px solid #f0f2f8' : 'none' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: rank === 0 ? '#b8860b' : '#9aa0b8', width: '20px' }}>#{rank + 1}</span>
              <div style={av(p.player_index)}>{p.name[0].toUpperCase()}</div>
              <span style={{ flex: 1, fontWeight: '500', color: '#0f1629' }}>
                {p.name}
                {p.player_index === room.spy_index && <span style={{ fontSize: '11px', color: '#a32d2d', marginLeft: '6px' }}>imposteur</span>}
              </span>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '16px', fontWeight: '700', color: '#1a56f0' }}>{scores[String(p.player_index)] || 0}</span>
                <span style={{ fontSize: '11px', color: '#9aa0b8', marginLeft: '3px' }}>pts</span>
              </div>
            </div>
          ))}
          <div style={{ marginTop: '10px', padding: '8px 10px', background: '#f7f8fc', borderRadius: '6px', fontSize: '11px', color: '#9aa0b8' }}>
            +2 pts / citoyen si imposteur éliminé · +3 pts pour l'imposteur s'il passe
          </div>
        </div>

        <div style={{ ...S.card, marginBottom: '12px' }}>
          <p style={{ ...S.sublabel, marginBottom: '12px' }}>Indices donnés</p>
          {players.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 0', borderBottom: i < players.length - 1 ? '1px solid #f0f2f8' : 'none' }}>
              <div style={av(i)}>{p.name[0].toUpperCase()}</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '500', color: '#0f1629', marginBottom: '4px' }}>
                  {p.name}{i === room.spy_index ? ' — imposteur' : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {(p.words || []).map((w, j) => <span key={j} style={{ background: '#f0f2f8', borderRadius: '20px', padding: '2px 9px', fontSize: '12px', color: '#4a5270' }}>{w}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', paddingBottom: '24px' }}>
          {myIndex === 0 ? (
            sessionOver
              ? <button onClick={endSession} style={{ ...S.btnPrimary, flex: 1 }}>Nouvelle session →</button>
              : <button onClick={playAgain} style={{ ...S.btnPrimary, flex: 1 }}>Manche suivante →</button>
          ) : (
            <div style={{ ...S.waiting, flex: 1 }}>En attente de l'hôte...</div>
          )}
          <button onClick={() => window.location.href = '/'}
            style={{ background: 'white', color: '#6b7390', border: '1px solid #e2e5ef', borderRadius: '8px', padding: '13px 16px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
            Quitter
          </button>
        </div>
      </div>
    </main>
  )
}

function av(i) {
  const bgs = ['#e8effe', '#e1f5ee', '#faeeda', '#fcebeb', '#f0effe', '#e8f5e9']
  const fgs = ['#0e3fc2', '#085041', '#633806', '#791f1f', '#5b21b6', '#1b5e20']
  return { width: '32px', height: '32px', borderRadius: '50%', background: bgs[i % bgs.length], color: fgs[i % fgs.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '13px', flexShrink: 0 }
}

const S = {
  page: { minHeight: '100vh', background: '#f7f8fc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
  card: { background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #e2e5ef', width: '100%' },
  sublabel: { fontSize: '11px', color: '#9aa0b8', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '600', margin: 0 },
  btnPrimary: { background: '#1a56f0', color: 'white', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  waiting: { textAlign: 'center', fontSize: '13px', color: '#9aa0b8', padding: '12px', background: '#f7f8fc', borderRadius: '8px' },
}