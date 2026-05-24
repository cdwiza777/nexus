'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

const PAIRS = [
  ['Lion','Tigre'],['Plage','Désert'],['Pizza','Tarte'],
  ['Avion','Fusée'],['Guitare','Violon'],['Château','Palais'],
  ['Requin','Dauphin'],['Forêt','Jungle'],['Banane','Mangue'],
  ['Football','Rugby'],['Hiver','Automne'],['Lune','Soleil'],
  ['Policier','Pompier'],['Cinéma','Théâtre'],['Montagne','Volcan'],
  ['Voiture','Moto'],['Chien','Chat'],['Roi','Président'],
  ['Épée','Lance'],['Café','Thé'],['Tigre','Léopard'],
  ['Piscine','Lac'],['Bus','Tramway'],['Crayon','Stylo'],
  ['Boulanger','Cuisinier'],['Tigre','Panthère'],['Rivière','Fleuve'],
  ['Château fort','Palais'],['Glace','Neige'],['Soldat','Chevalier'],
  ['Hibou','Aigle'],['Dauphin','Baleine'],['Rose','Tulipe'],
  ['Tambour','Guitare'],['Manteau','Veste'],['Château','Manoir'],
]

function genCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase()
}

export default function Home() {
  const router = useRouter()
  const [step, setStep] = useState('home')
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [wordsPerPlayer, setWordsPerPlayer] = useState(3)
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [winMode, setWinMode] = useState('manches')
  const [targetManches, setTargetManches] = useState(5)
  const [targetScore, setTargetScore] = useState(10)
  const [spyMode, setSpyMode] = useState('knows') // 'knows' | 'blind'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createRoom() {
    if (!name.trim()) { setError('Entre ton pseudo !'); return }
    setLoading(true); setError('')
    const code = genCode()
    const pair = PAIRS[Math.floor(Math.random() * PAIRS.length)]
    const spyIndex = Math.floor(Math.random() * maxPlayers)

    const { error: e1 } = await supabase.from('rooms').insert({
      id: code,
      citizen_word: pair[0],
      spy_word: pair[1],
      spy_index: spyIndex,
      words_per_player: wordsPerPlayer,
      total_rounds: wordsPerPlayer,
      max_players: maxPlayers,
      current_round: 0,
      current_player: 0,
      phase: 'lobby',
      votes: {},
      scores: {},
      win_mode: winMode,
      target_manches: targetManches,
      target_score: targetScore,
      manche_number: 1,
      session_over: false,
      spy_mode: spyMode,
      used_pairs: [pair[0] + '|' + pair[1]],
    })
    if (e1) { setError('Erreur room: ' + e1.message); setLoading(false); return }

    const { error: e2 } = await supabase.from('players').insert({
      room_id: code, name: name.trim(), player_index: 0, words: [], ready: false, score: 0,
    })
    if (e2) { setError('Erreur player: ' + e2.message); setLoading(false); return }

    router.push(`/room/${code}?p=0&n=${encodeURIComponent(name.trim())}`)
  }

  async function joinRoom() {
    if (!name.trim()) { setError('Entre ton pseudo !'); return }
    if (!joinCode.trim()) { setError('Entre le code !'); return }
    setLoading(true); setError('')
    const code = joinCode.trim().toUpperCase()

    const { data: room, error: re } = await supabase.from('rooms').select('*').eq('id', code).single()
    if (re || !room) { setError('Salle introuvable : ' + (re?.message || '')); setLoading(false); return }
    if (room.phase !== 'lobby') { setError('Partie déjà commencée'); setLoading(false); return }

    const { data: existing, error: ee } = await supabase.from('players').select('*').eq('room_id', code)
    if (ee) { setError('Erreur joueurs: ' + ee.message); setLoading(false); return }
    if (existing.length >= room.max_players) { setError('Salle pleine !'); setLoading(false); return }

    const idx = existing.length
    const { error: e2 } = await supabase.from('players').insert({
      room_id: code, name: name.trim(), player_index: idx, words: [], ready: false, score: 0,
    })
    if (e2) { setError('Erreur insertion: ' + e2.message); setLoading(false); return }

    router.push(`/room/${code}?p=${idx}&n=${encodeURIComponent(name.trim())}`)
  }

  if (step === 'home') return (
    <main style={S.page}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '6px', color: '#0f1629' }}>
            NEX<span style={{ color: '#1a56f0' }}>U</span>S
          </h1>
          <p style={{ color: '#6b7390', fontSize: '14px', marginTop: '6px' }}>Le Mot Piège — multijoueur en ligne</p>
        </div>
        <button onClick={() => { setStep('create'); setError('') }}
          style={{ ...S.bigBtn, background: '#1a56f0', color: 'white', marginBottom: '12px', border: 'none' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ display: 'block', margin: '0 auto 8px' }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <div style={{ fontSize: '18px', fontWeight: '700' }}>Créer une salle</div>
          <div style={{ fontSize: '13px', opacity: .8, marginTop: '2px' }}>Tu invites tes amis avec un code</div>
        </button>
        <button onClick={() => { setStep('join'); setError('') }}
          style={{ ...S.bigBtn, background: 'white', color: '#0f1629', border: '1.5px solid #e2e5ef' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1a56f0" strokeWidth="2" style={{ display: 'block', margin: '0 auto 8px' }}>
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          <div style={{ fontSize: '18px', fontWeight: '700' }}>Rejoindre une salle</div>
          <div style={{ fontSize: '13px', color: '#6b7390', marginTop: '2px' }}>Tu as un code d'invitation</div>
        </button>
      </div>
    </main>
  )

  if (step === 'create') return (
    <main style={{ ...S.page, alignItems: 'flex-start', paddingTop: '32px' }}>
      <div style={{ width: '100%', maxWidth: '400px', margin: '0 auto' }}>
        <button onClick={() => { setStep('home'); setError('') }} style={S.back}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7390" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          Retour
        </button>
        <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f1629', marginBottom: '4px' }}>Nouvelle salle</h2>
        <p style={{ fontSize: '14px', color: '#6b7390', marginBottom: '20px' }}>Configure ta partie et partage le code.</p>

        <div style={S.card}>
          {/* Pseudo */}
          <label style={S.label}>Ton pseudo</label>
          <input style={S.input} value={name} onChange={e => setName(e.target.value)}
            placeholder="Entre ton pseudo..." autoFocus
            onKeyDown={e => e.key === 'Enter' && createRoom()} />

          {/* Joueurs + indices */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Joueurs</label>
              <select style={S.select} value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))}>
                {[3, 4, 5, 6].map(n => <option key={n} value={n}>{n} joueurs</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Indices par joueur</label>
              <select style={S.select} value={wordsPerPlayer} onChange={e => setWordsPerPlayer(Number(e.target.value))}>
                {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n} indices</option>)}
              </select>
            </div>
          </div>
          <p style={{ fontSize: '11px', color: '#9aa0b8', marginTop: '5px' }}>
            Chaque joueur donnera {wordsPerPlayer} mot{wordsPerPlayer > 1 ? 's' : ''} un par un, à tour de rôle
          </p>

          {/* Mode imposteur */}
          <label style={S.label}>Mode imposteur</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
            <button onClick={() => setSpyMode('knows')}
              style={{ flex: 1, padding: '10px 8px', borderRadius: '8px', border: spyMode === 'knows' ? '2px solid #1a56f0' : '1px solid #e2e5ef', background: spyMode === 'knows' ? '#e8effe' : 'white', color: spyMode === 'knows' ? '#0e3fc2' : '#6b7390', fontWeight: '600', fontSize: '12px', cursor: 'pointer', textAlign: 'center' }}>
              Sait qu'il est imposteur
            </button>
            <button onClick={() => setSpyMode('blind')}
              style={{ flex: 1, padding: '10px 8px', borderRadius: '8px', border: spyMode === 'blind' ? '2px solid #e02d2d' : '1px solid #e2e5ef', background: spyMode === 'blind' ? '#fcebeb' : 'white', color: spyMode === 'blind' ? '#a32d2d' : '#6b7390', fontWeight: '600', fontSize: '12px', cursor: 'pointer', textAlign: 'center' }}>
              Ne sait pas (aveugle)
            </button>
          </div>
          <p style={{ fontSize: '11px', color: '#9aa0b8', marginTop: '4px' }}>
            {spyMode === 'knows'
              ? 'L\'imposteur sait son rôle et bluff consciemment'
              : 'L\'imposteur reçoit juste un mot différent — plus déstabilisant'}
          </p>

          {/* Condition de victoire */}
          <label style={S.label}>Condition de victoire</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            {[['manches', 'Manches'], ['score', 'Score cible']].map(([val, label]) => (
              <button key={val} onClick={() => setWinMode(val)}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: winMode === val ? '2px solid #1a56f0' : '1px solid #e2e5ef', background: winMode === val ? '#e8effe' : 'white', color: winMode === val ? '#0e3fc2' : '#6b7390', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>

          {winMode === 'manches' ? (
            <div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[3, 5, 7, 10].map(n => (
                  <button key={n} onClick={() => setTargetManches(n)}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: targetManches === n ? '2px solid #1a56f0' : '1px solid #e2e5ef', background: targetManches === n ? '#e8effe' : 'white', color: targetManches === n ? '#0e3fc2' : '#6b7390', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>
                    {n}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: '11px', color: '#9aa0b8', marginTop: '6px' }}>~{targetManches * 7} min de jeu</p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[8, 10, 15, 20].map(n => (
                  <button key={n} onClick={() => setTargetScore(n)}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: targetScore === n ? '2px solid #1a56f0' : '1px solid #e2e5ef', background: targetScore === n ? '#e8effe' : 'white', color: targetScore === n ? '#0e3fc2' : '#6b7390', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>
                    {n}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: '11px', color: '#9aa0b8', marginTop: '6px' }}>Premier à {targetScore} pts gagne la session</p>
            </div>
          )}

          {error && <div style={S.error}>{error}</div>}
          <button onClick={createRoom} disabled={loading}
            style={{ ...S.btnPrimary, marginTop: '16px', width: '100%', opacity: loading ? .6 : 1 }}>
            {loading ? 'Création...' : 'Créer la salle →'}
          </button>
        </div>
      </div>
    </main>
  )

  if (step === 'join') return (
    <main style={S.page}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <button onClick={() => { setStep('home'); setError('') }} style={S.back}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7390" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          Retour
        </button>
        <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f1629', marginBottom: '4px' }}>Rejoindre</h2>
        <p style={{ fontSize: '14px', color: '#6b7390', marginBottom: '20px' }}>Entre le code que ton ami t'a partagé.</p>
        <div style={S.card}>
          <label style={S.label}>Ton pseudo</label>
          <input style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="Entre ton pseudo..." autoFocus />
          <label style={S.label}>Code de la salle</label>
          <input
            style={{ ...S.input, fontSize: '24px', fontWeight: '700', letterSpacing: '8px', textAlign: 'center', textTransform: 'uppercase' }}
            value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="XXXXX" maxLength={5}
            onKeyDown={e => e.key === 'Enter' && joinRoom()} />
          {error && <div style={S.error}>{error}</div>}
          <button onClick={joinRoom} disabled={loading}
            style={{ ...S.btnPrimary, marginTop: '16px', width: '100%', opacity: loading ? .6 : 1 }}>
            {loading ? 'Connexion...' : 'Rejoindre →'}
          </button>
        </div>
      </div>
    </main>
  )
}

const S = {
  page: { minHeight: '100vh', background: '#f7f8fc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
  bigBtn: { width: '100%', borderRadius: '14px', padding: '22px 16px', textAlign: 'center', cursor: 'pointer' },
  card: { background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #e2e5ef' },
  label: { fontSize: '13px', color: '#6b7390', display: 'block', marginBottom: '6px', fontWeight: '500', marginTop: '14px' },
  input: { width: '100%', border: '1px solid #e2e5ef', borderRadius: '8px', padding: '11px 14px', fontSize: '15px', outline: 'none', color: '#0f1629', background: 'white', display: 'block' },
  select: { width: '100%', border: '1px solid #e2e5ef', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', background: 'white', color: '#0f1629', outline: 'none' },
  btnPrimary: { background: '#1a56f0', color: 'white', border: 'none', borderRadius: '8px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  back: { display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#6b7390', fontSize: '14px', cursor: 'pointer', padding: '0', marginBottom: '20px' },
  error: { background: '#fcebeb', color: '#a32d2d', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginTop: '12px', fontWeight: '500' },
}