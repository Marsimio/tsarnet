import { useState, useEffect, useRef } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { auth, db } from './firebase'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  signInAnonymously
} from 'firebase/auth'
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  setDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from 'firebase/firestore'
const mapImg = '/allies/map.png'
const ALLIES_ASSETS = ['friend.png']
const BOUNTY_ASSETS = ['target.png', 'wanted.png']
const PUBLIC_DOMAIN_ASSETS = ['pin_default.png', 'soldier.png', 'scout.png', 'target.png', 'intel.png', 'hazard.png']
const GENERATIONS = [
  'TSAR',
  'GENERATION 1',
  'GENERATION 2',
  'GENERATION 3',
  'GENERATION 4',
  'FRIENDS OF THE TSAR',
  'ENEMIES OF THE TSAR'
]
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('MAP')
  const [faq, setFaq] = useState({ content: '' })

  const getLakeErieTime = (date = new Date()) => {
    const options = {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      month: '2-digit',
      day: '2-digit'
    }
    const formatter = new Intl.DateTimeFormat('en-US', options)
    const parts = formatter.formatToParts(date)
    const d = {}
    parts.forEach(p => d[p.type] = p.value)
    return `${d.month}/${d.day}/2166, ${d.hour}:${d.minute}:${d.second}`
  }

  const [currentTime, setCurrentTime] = useState(getLakeErieTime())

  // Auth state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isGuest, setIsGuest] = useState(false)

  // System Modal state (Custom alerts/confirms)
  const [showSystemModal, setShowSystemModal] = useState(false)
  const [systemModalConfig, setSystemModalConfig] = useState({
    title: 'SYSTEM MESSAGE',
    message: '',
    confirmText: 'OK',
    cancelText: null,
    onConfirm: () => setShowSystemModal(false),
    onCancel: null
  })

  // Map state
  const [pins, setPins] = useState([])
  const mapRef = useRef(null)

  // Comments state
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')

  // Helper for text formatting
  const parseTerminalText = (text) => {
    if (!text) return ''
    const parts = text.split(/(\[#[0-9a-fA-F]{3,6}\]|\[\/#\])/g)
    let currentColor = null

    return parts.map((part, index) => {
      if (!part) return null
      if (part.startsWith('[#') && part.endsWith(']')) {
        currentColor = part.slice(1, -1)
        return null
      } else if (part === '[/#]') {
        currentColor = null
        return null
      } else {
        return <span key={index} style={{ color: currentColor || 'inherit' }}>{part}</span>
      }
    }).filter(p => p !== null)
  }


// Normalize image values from Firestore.
  const cleanImageValue = (value) => {
    if (typeof value !== 'string') return ''

    return value
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .replace(/\\/g, '/')
  }

  const getFileName = (value) => {
    const cleaned = cleanImageValue(value)
    if (!cleaned) return ''

    return cleaned.split('/').pop()
  }

  const getRecordImage = (item, folder) => {
    if (!item) return ''

    const selectedFile = getFileName(item.publicDomainFile)

    if (selectedFile) {
      return `/${folder}/${encodeURIComponent(selectedFile)}`
    }

    const imageUrl = cleanImageValue(item.imageUrl)

    // Convert accidental local Windows/public paths into browser URLs.
    const publicIndex = imageUrl.toLowerCase().indexOf('/public/')

    if (publicIndex !== -1) {
      return imageUrl.slice(publicIndex + '/public'.length)
    }

    return imageUrl
  }

  // Characters & Bounties state
  const [characters, setCharacters] = useState([])
  const [bounties, setBounties] = useState([])

  // CRUD Modal state
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState('NETWORK') // NETWORK or BOUNTIES
  const [editItem, setEditItem] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    description: '',
    generation: 'GENERATION 1',
    target: '',
    reward: '',
    status: '',
    imageUrl: '',
    publicDomainFile: ''
  })
  const [uploading, setUploading] = useState(false)

  // Profile View state
  const [showProfile, setShowProfile] = useState(false)
  const [profileItem, setProfileItem] = useState(null)
  const [profileType, setProfileType] = useState('NETWORK')

  // Pin Modal state
  const [showPinModal, setShowPinModal] = useState(false)
  const [editPin, setEditPin] = useState(null)
  const [pinFormData, setPinFormData] = useState({
    label: '',
    description: '',
    imageUrl: '',
    publicDomainFile: '',
    tempCoords: null
  })
  const [pinMode, setPinMode] = useState('VIEW') // VIEW or EDIT

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getLakeErieTime())
    }, 1000)

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setIsGuest(u?.isAnonymous || false)
      setLoading(false)
    })

    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [])

  // Tsar Admin Account
  const isAdmin = user && user.email && user.email.toLowerCase() === 'bartsar@tsarnet.local'

  // Helper for custom terminal popups
  const terminalAlert = (message, title = 'SYSTEM MESSAGE') => {
    setSystemModalConfig({
      title,
      message,
      confirmText: 'DISMISS',
      onConfirm: () => setShowSystemModal(false)
    })
    setShowSystemModal(true)
  }

  const terminalConfirm = (message, onConfirm, title = 'CONFIRMATION REQUIRED') => {
    setSystemModalConfig({
      title,
      message,
      confirmText: 'PROCEED',
      cancelText: 'ABORT',
      onConfirm: () => {
        onConfirm()
        setShowSystemModal(false)
      },
      onCancel: () => setShowSystemModal(false)
    })
    setShowSystemModal(true)
  }

  // Real-time data listeners
  useEffect(() => {
    if (!user) return

    const qPins = query(collection(db, 'pins'))
    const unsubPins = onSnapshot(qPins, (snapshot) => {
      setPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    })

    const qChars = query(collection(db, 'characters'), orderBy('name'))
    const unsubChars = onSnapshot(qChars, (snapshot) => {
      setCharacters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    })

    const qBounties = query(collection(db, 'bounties'), orderBy('reward', 'desc'))
    const unsubBounties = onSnapshot(qBounties, (snapshot) => {
      setBounties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    })

    const qComments = query(collection(db, 'comments'), orderBy('timestamp', 'asc'))
    const unsubComments = onSnapshot(qComments, (snapshot) => {
      setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    })

    const unsubFaq = onSnapshot(doc(db, 'settings', 'faq'), (docSnap) => {
      if (docSnap.exists()) {
        setFaq(docSnap.data())
      }
    })

    return () => {
      unsubPins()
      unsubChars()
      unsubBounties()
      unsubComments()
      unsubFaq()
    }
  }, [user])

  const handleLogin = async (e) => {
    e.preventDefault()
    setIsGuest(false)
    setError('')
    const email = `${username}@tsarnet.local`
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        try {
          await createUserWithEmailAndPassword(auth, email, password)
        } catch (createErr) {
          setError(createErr.message)
        }
      } else {
        setError(err.message)
      }
    }
  }

  const handleGuestLogin = async () => {
    setError('')

    try {
      await signInAnonymously(auth)
      setIsGuest(true)
    } catch (err) {
      console.error('Guest login failed:', err)
      setError(err.message)
    }
  }

  const handleLogout = () => {
    signOut(auth)
    setIsGuest(false)
  }

  const handleSaveFaq = async (newContent) => {
    if (!isAdmin) return
    try {
      await setDoc(doc(db, 'settings', 'faq'), { content: newContent })
      terminalAlert("FAQ UPDATED SUCCESSFULLY.")
    } catch (err) {
      console.error("Error saving FAQ:", err)
      terminalAlert("FAILED TO SAVE FAQ.")
    }
  }

  const openModal = (type, item = null) => {
    setModalType(type)
    setEditItem(item)
    if (item) {
      setFormData({
        name: item.name || '',
        role: item.role || '',
        description: item.description || '',
        generation: item.generation || 'GENERATION 1',
        target: item.target || '',
        reward: item.reward || '',
        status: item.status || '',
        imageUrl: item.imageUrl || '',
        publicDomainFile: item.publicDomainFile || ''
      })
    } else {
      setFormData({
        name: '',
        role: '',
        description: '',
        generation: 'GENERATION 1',
        target: '',
        reward: '',
        status: type === 'NETWORK' ? 'ACTIVE' : 'PENDING',
        imageUrl: '',
        publicDomainFile: ''
      })
    }
    setShowModal(true)
  }

  const openProfile = (type, item) => {
    setProfileType(type)
    setProfileItem(item)
    setShowProfile(true)
  }

  const handleDelete = async (collectionName, id) => {
    if (!isAdmin) return
    terminalConfirm("ARE YOU SURE YOU WANT TO DELETE THIS RECORD?", async () => {
      try {
        await deleteDoc(doc(db, collectionName, id))
      } catch (err) {
        console.error("Error deleting record:", err)
        terminalAlert("FAILED TO DELETE RECORD.")
      }
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!isAdmin) return
    setUploading(true)
    try {
      const selectedFile = cleanImageValue(formData.publicDomainFile)
      let imageUrl = cleanImageValue(formData.imageUrl)

      if (selectedFile) {
        const folder = modalType === 'NETWORK' ? 'allies' : 'bounty'
        imageUrl = `/${folder}/${selectedFile}`
      }

      const collectionName = modalType === 'NETWORK' ? 'characters' : 'bounties'
      const data = modalType === 'NETWORK'
          ? {
            name: formData.name,
            role: formData.role,
            description: formData.description,
            reward: formData.reward,
            generation: formData.generation,
            status: formData.status || 'ACTIVE',
            imageUrl,
            publicDomainFile: selectedFile
          }
          : {
            target: formData.target,
            reward: formData.reward,
            description: formData.description,
            status: formData.status || 'PENDING',
            imageUrl,
            publicDomainFile: selectedFile
          }

      if (editItem) {
        await updateDoc(doc(db, collectionName, editItem.id), data)
      } else {
        await addDoc(collection(db, collectionName), data)
      }
      setShowModal(false)
    } catch (err) {
      console.error("Error saving record:", err)
      terminalAlert("FAILED TO SAVE RECORD.")
    } finally {
      setUploading(false)
    }
  }

  const handleMapContextMenu = (e) => {
    e.preventDefault()
    if (activeTab !== 'MAP' || isGuest) return
    // If we click on an existing pin, this event might be stopped by the pin's own onContextMenu
    // But we need to make sure we're clicking on the map itself.
    if (e.target.className !== 'map-wrapper' && e.target.className !== 'map-image' && e.target.className !== 'map-grid-overlay') return

    const rect = mapRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    setPinFormData({ label: '', description: '', imageUrl: '', publicDomainFile: '', tempCoords: { x, y } })
    setEditPin(null)
    setPinMode('EDIT')
    setShowPinModal(true)
  }

  const openPinModal = (pin, mode = 'VIEW') => {
    setEditPin(pin)
    setPinMode(mode)
    setPinFormData({
      label: pin.label || '',
      description: pin.description || '',
      imageUrl: pin.imageUrl || '',
      publicDomainFile: pin.publicDomainFile || '',
      tempCoords: { x: pin.x, y: pin.y }
    })
    setShowPinModal(true)
  }

  const handleSavePin = async (e) => {
    e.preventDefault()

    const canEditPin =
        !isGuest && (
            isAdmin ||
            !editPin ||
            editPin.createdBy === user?.email
        )

    if (!canEditPin) {
      terminalAlert('UNAUTHORIZED.')
      return
    }

    setUploading(true)

    try {
      const selectedPinFile = cleanImageValue(pinFormData.publicDomainFile)
      let imageUrl = cleanImageValue(pinFormData.imageUrl)

      if (selectedPinFile) {
        imageUrl = `/public_domain/${selectedPinFile}`
      }

      const data = {
        label: pinFormData.label,
        description: pinFormData.description,
        imageUrl,
        publicDomainFile: selectedPinFile,
        x: pinFormData.tempCoords.x,
        y: pinFormData.tempCoords.y,
        createdBy: editPin?.createdBy || user.email,
        timestamp: editPin?.timestamp || serverTimestamp()
      }

      if (editPin) {
        await updateDoc(doc(db, 'pins', editPin.id), data)
      } else {
        await addDoc(collection(db, 'pins'), data)
      }

      setShowPinModal(false)
    } catch (err) {
      console.error('Error saving pin:', err)
      terminalAlert(err.message || 'FAILED TO SAVE PIN.')
    } finally {
      setUploading(false)
    }
  }

  const handleDeletePin = async (id) => {
    const canDelete =
        !isGuest && (isAdmin || editPin?.createdBy === user?.email)

    if (!canDelete) {
      terminalAlert('UNAUTHORIZED.')
      return
    }

    terminalConfirm('REMOVE THIS PIN?', async () => {
      try {
        await deleteDoc(doc(db, 'pins', id))
        setShowPinModal(false)
      } catch (err) {
        console.error('Error deleting pin:', err)
        terminalAlert(err.message || 'FAILED TO DELETE PIN.')
      }
    })
  }

  const handleAddComment = async (targetId) => {
    const text = commentText.trim()

    if (!user || isGuest || !text || !targetId) return

    try {
      await addDoc(collection(db, 'comments'), {
        targetId,
        text,
        createdBy: user.email,
        timestamp: serverTimestamp(),
        displayTime: getLakeErieTime()
      })

      setCommentText('')
    } catch (err) {
      console.error('Error adding comment:', err.code, err.message)
      terminalAlert(`${err.code}: ${err.message}`)
    }
  }

  const handleDeleteComment = async (comment) => {
    const canDelete =
        !isGuest && (isAdmin || comment.createdBy === user?.email)

    if (!canDelete) {
      terminalAlert('UNAUTHORIZED.')
      return
    }

    terminalConfirm('DELETE THIS COMMENT?', async () => {
      try {
        await deleteDoc(doc(db, 'comments', comment.id))
      } catch (err) {
        console.error('Error deleting comment:', err)
        terminalAlert(err.message || 'FAILED TO DELETE COMMENT.')
      }
    })
  }

  const renderComments = (targetId) => {
    const targetComments = comments.filter(c => c.targetId === targetId)
    return (
        <div className="comments-section" style={{ marginTop: '20px', borderTop: '1px solid var(--terminal-red-dim)', paddingTop: '10px' }}>
          <div style={{ fontSize: '0.9rem', marginBottom: '10px' }}>[ COMMENTS ]</div>
          <div
              className="comments-list"
              style={{maxHeight: '150px', overflowY: 'auto', marginBottom: '10px'}}>
            {targetComments.length === 0 && <div style={{ fontSize: '0.7rem', color: '#666' }}>NO COMMENTS YET.</div>}
            {targetComments.map(c => {
              const displayTime = c.displayTime || (c.timestamp ? getLakeErieTime(c.timestamp.toDate ? c.timestamp.toDate() : new Date(c.timestamp)) : 'DATE UNKNOWN')
              return (
                  <div key={c.id} className="comment-item" style={{ fontSize: '0.8rem', marginBottom: '8px', position: 'relative' }}>
                <span className="comment-username">
                  {c.createdBy?.split('@')[0] || 'SLAB'}:
                  <span className="terminal-tooltip">{displayTime}</span>
                </span>
                    <span>{parseTerminalText(c.text)}</span>
                    {(isAdmin || (!isGuest && c.createdBy === user?.email)) && (
                        <span
                            onClick={() => handleDeleteComment(c)}
                            style={{
                              marginLeft: '10px',
                              color: '#666',
                              cursor: 'pointer',
                              fontSize: '0.6rem'
                            }}
                        >
                      [X]
                    </span>
                    )}
                  </div>
              )
            })}
          </div>
          {!isGuest ? (
              <div className="comment-input-group" style={{ display: 'flex', gap: '5px' }}>
                <input
                    className="terminal-input"
                    placeholder="ADD COMMENT..."
                    style={{ flexGrow: 1, fontSize: '0.8rem' }}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddComment(targetId)
                      }
                    }}
                />
                <button className="terminal-button" style={{ padding: '5px 10px', fontSize: '0.7rem' }} onClick={() => handleAddComment(targetId)}>
                  SEND
                </button>
              </div>
          ) : (
              <div style={{ fontSize: '0.7rem', color: 'var(--terminal-red-dim)', fontStyle: 'italic', opacity: 0.7 }}>
                [ AUTHENTICATION REQUIRED TO POST COMMENTS ]
              </div>
          )}
        </div>
    )
  }

  if (loading) return <div className="terminal-window"><div className="terminal-content">LOADING...</div></div>

  return (
      <div className="terminal-window">
        <div className="terminal-header">
          <span>TSARNET TERMINAL v1.1.0</span>
          <span>{currentTime}</span>
          {user && <span style={{ marginLeft: '20px' }}>LOGGED IN AS: {isGuest ? 'SLAB' : user.email?.split('@')[0]}</span>}
          <div className="header-buttons">
            {user && <span className="logout-btn" onClick={handleLogout}>[ LOGOUT ]</span>}
            <span>□</span>
            <span onClick={() => window.close()}>X</span>
          </div>
        </div>

        <div className="terminal-content">
          <div className="scanlines"></div>
          <div className="flicker"></div>

          {!user ? (
              <div className="login-container">
                <div className="terminal-prompt">
                  <span style={{ color: '#fff' }}>SYSTEM ACCESS REQUIRED</span>
                </div>
                <form className="login-form" onSubmit={handleLogin}>
                  <input
                      className="terminal-input"
                      placeholder="USERNAME"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                  />
                  <input
                      className="terminal-input"
                      type="password"
                      placeholder="PASSWORD"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="submit" className="terminal-button">AUTHENTICATE</button>
                  <button type="button" className="terminal-button" style={{ background: '#444' }} onClick={handleGuestLogin}>I'm a slab :(</button>
                  {error && <div style={{ color: 'red', fontSize: '0.8rem' }}>{error}</div>}
                </form>
              </div>
          ) : (
              <>
                <div style={{ marginBottom: '10px', fontSize: '0.8rem' }}>
                  EMAIL: {user?.email} | ADMIN: {isAdmin ? 'YES' : 'NO'}
                </div>

                <div className="terminal-nav">
                  <div className={`nav-item ${activeTab === 'MAP' ? 'active' : ''}`} onClick={() => setActiveTab('MAP')}>[ 01 MAP ]</div>
                  <div className={`nav-item ${activeTab === 'NETWORK' ? 'active' : ''}`} onClick={() => setActiveTab('NETWORK')}>[ 02 NETWORK ]</div>
                  <div className={`nav-item ${activeTab === 'BOUNTIES' ? 'active' : ''}`} onClick={() => setActiveTab('BOUNTIES')}>[ 03 BOUNTY BOARD ]</div>
                  <div className={`nav-item ${activeTab === 'FAQ' ? 'active' : ''}`} onClick={() => setActiveTab('FAQ')}>[ 04 FAQ ]</div>
                </div>

            {activeTab === 'MAP' && (
                <div className="terminal-map-container">
                  <TransformWrapper
                      initialScale={1}
                      minScale={0.8}
                      maxScale={8}
                      centerOnInit
                      limitToBounds
                      smoothWheel={{
                        step: 0.1,
                        smoothStep: 0.01
                      }}
                      doubleClick={{ disabled: true }}
                  >
                    {({ zoomIn, zoomOut, resetTransform }) => (
                        <>
                          <div className="map-controls">
                            <span className="control-btn" onClick={() => zoomIn(0.5)}>[ ZOOM+ ]</span>
                            <span className="control-btn" onClick={() => zoomOut(0.5)}>[ ZOOM- ]</span>
                            <span className="control-btn" onClick={() => resetTransform()}>[ RESET ]</span>
                          </div>
                          <TransformComponent
                              wrapperStyle={{ width: '100%', height: '100%' }}
                              contentStyle={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                          >
                            <div className="map-wrapper" ref={mapRef} onContextMenu={handleMapContextMenu}>
                              <img src={mapImg} className="map-image" alt="Map" draggable="false" />
                              <div className="map-grid-overlay"></div>
                              {pins.map(pin => (
                                  <div
                                      key={pin.id}
                                      className="map-pin"
                                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                                      data-label={`${pin.label} (BY: ${pin.createdBy ? pin.createdBy.split('@')[0] : 'UNKNOWN'})`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        openPinModal(pin, 'VIEW')
                                      }}
                                      onContextMenu={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        if (isAdmin || (!isGuest && user.email === pin.createdBy)) {
                                          openPinModal(pin, 'EDIT')
                                        }
                                      }}
                                  />
                              ))}
                            </div>
                          </TransformComponent>
                        </>
                    )}
                  </TransformWrapper>
                </div>
            )}

            {activeTab === 'NETWORK' && (
                <div className="list-container">
                  <div className="terminal-prompt">
                    <span style={{ color: '#fff' }}># NETWORK DATABASE</span>
                  </div>
                  {characters.length === 0 && <div>NO RECORDS FOUND.</div>}

                  {GENERATIONS.map(gen => {
                    const genChars = characters.filter(c => (c.generation || 'GENERATION 1') === gen)
                    if (genChars.length === 0) return null

                    return (
                        <div key={gen} className="generation-section" style={{ marginBottom: '30px' }}>
                          <div className="generation-header" style={{
                            borderBottom: '1px solid var(--terminal-red)',
                            paddingBottom: '5px',
                            marginBottom: '15px',
                            color: '#fff',
                            fontSize: '1rem',
                            fontWeight: 'bold'
                          }}>
                            :: {gen}
                          </div>
                          <div className="grid-list">
                            {genChars.map(char => (
                                <div key={char.id} className="grid-item clickable" onClick={() => openProfile('NETWORK', char)}>
                                  {getRecordImage(char, 'allies') && (
                                      <img
                                          src={getRecordImage(char, 'allies')}
                                          alt={char.name}
                                          className="item-image"
                                          loading="lazy"
                                          onError={(e) => {
                                            console.error('Network image failed:', {
                                              requested: e.currentTarget.src,
                                              item: char
                                            })
                                          }}
                                      />
                                  )}
                                  <div className="item-info">
                                    <div className="item-header">
                                      <span className="item-title">{char.name}</span>
                                      <span className="status-badge">{char.status}</span>
                                    </div>
                                    <div className="item-sub">{char.role}</div>
                                    {char.description && (
                                        <div className="item-desc-snippet" style={{
                                          fontSize: '0.7rem',
                                          color: '#888',
                                          marginTop: '5px',
                                          display: '-webkit-box',
                                          WebkitLineClamp: '2',
                                          WebkitBoxOrient: 'vertical',
                                          overflow: 'hidden'
                                        }}>
                                          {char.description}
                                        </div>
                                    )}
                                    {isAdmin && (
                                        <div className="item-actions">
                                          <span onClick={(e) => { e.stopPropagation(); openModal('NETWORK', char); }}>[ EDIT ]</span>
                                          <span onClick={(e) => { e.stopPropagation(); handleDelete('characters', char.id); }} style={{ color: '#888' }}>[ DELETE ]</span>
                                        </div>
                                    )}
                                  </div>
                                </div>
                            ))}
                          </div>
                        </div>
                    )
                  })}

                  {isAdmin && (
                      <button
                          className="terminal-button"
                          style={{ marginTop: '20px' }}
                          onClick={() => openModal('NETWORK')}
                      >
                        + REGISTER NEW ENTITY
                      </button>
                  )}
                </div>
            )}

                {activeTab === 'BOUNTIES' && (
                    <div className="list-container">
                      <div className="terminal-prompt">
                        <span style={{ color: '#fff' }}># ACTIVE BOUNTIES</span>
                      </div>
                      {bounties.length === 0 && <div>CLEAR BOARD. NO ACTIVE THREATS.</div>}
                      <div className="grid-list">
                        {bounties.map(bounty => (
                            <div key={bounty.id} className="grid-item clickable" onClick={() => openProfile('BOUNTIES', bounty)}>
                              {getRecordImage(bounty, 'bounty') && (
                                  <img
                                      src={getRecordImage(bounty, 'bounty')}
                                      alt={bounty.target}
                                      className="item-image"
                                      loading="lazy"
                                      onError={(e) => {
                                        console.error('Bounty image failed:', {
                                          requested: e.currentTarget.src,
                                          item: bounty
                                        })
                                        e.currentTarget.style.display = 'none'
                                      }}
                                  />
                              )}
                              <div className="item-info">
                                <div className="item-header">
                                  <span className="item-title">{bounty.target}</span>
                                  <span className="status-badge" style={{ borderColor: bounty.status === 'COMPLETED' ? '#444' : 'var(--terminal-red)' }}>
                            {bounty.status}
                          </span>
                                </div>
                                <div className="item-sub">{bounty.reward}</div>
                                {bounty.description && (
                                    <div className="item-desc-snippet" style={{
                                      fontSize: '0.7rem',
                                      color: '#888',
                                      marginTop: '5px',
                                      display: '-webkit-box',
                                      WebkitLineClamp: '2',
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden'
                                    }}>
                                      {bounty.description}
                                    </div>
                                )}
                                {isAdmin && (
                                    <div className="item-actions">
                                      <span onClick={(e) => { e.stopPropagation(); openModal('BOUNTIES', bounty); }}>[ EDIT ]</span>
                                      <span onClick={(e) => { e.stopPropagation(); handleDelete('bounties', bounty.id); }} style={{ color: '#888' }}>[ DELETE ]</span>
                                    </div>
                                )}
                              </div>
                            </div>
                        ))}
                      </div>
                      {isAdmin && (
                          <button
                              className="terminal-button"
                              style={{ marginTop: '20px' }}
                              onClick={() => openModal('BOUNTIES')}
                          >
                            + POST BOUNTY
                          </button>
                      )}
                    </div>
                )}

                {activeTab === 'FAQ' && (
                    <div className="list-container">
                      <div className="terminal-prompt">
                        <span style={{ color: '#fff' }}># FREQUENTLY ASKED QUESTIONS</span>
                      </div>
                      <div className="faq-content" style={{
                        border: '1px solid var(--terminal-red-dim)',
                        padding: '20px',
                        background: 'rgba(255, 49, 49, 0.05)',
                        minHeight: '200px',
                        whiteSpace: 'pre-wrap'
                      }}>
                        {parseTerminalText(faq.content) || 'NO FAQ DATA FOUND.'}
                      </div>
                      {isAdmin && (
                          <button
                              className="terminal-button"
                              style={{ marginTop: '20px' }}
                              onClick={() => {
                                // Using a prompt-like terminal modal for FAQ editing
                                setSystemModalConfig({
                                  title: 'EDIT FAQ CONTENT',
                                  message: 'ENTER NEW FAQ TEXT (MARKUP SUPPORTED):',
                                  confirmText: 'SAVE FAQ',
                                  cancelText: 'ABORT',
                                  isInput: true,
                                  defaultValue: faq.content,
                                  onConfirm: (val) => {
                                    handleSaveFaq(val)
                                    setShowSystemModal(false)
                                  },
                                  onCancel: () => setShowSystemModal(false)
                                })
                                setShowSystemModal(true)
                              }}
                          >
                            EDIT FAQ
                          </button>
                      )}
                    </div>
                )}

                {showProfile && profileItem && (
                    <div className="modal-overlay">
                      <div className="terminal-window modal-window" style={{ width: '600px' }}>
                        <div className="terminal-header">
                          <span>{profileType} PROFILE: {profileType === 'NETWORK' ? profileItem.name : profileItem.target}</span>
                          <span onClick={() => setShowProfile(false)} style={{ cursor: 'pointer' }}>X</span>
                        </div>
                        <div className="terminal-content">
                          <div className="profile-view" style={{ display: 'flex', gap: '20px', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', gap: '20px' }}>
                              {getRecordImage(
                                  profileItem,
                                  profileType === 'NETWORK' ? 'allies' : 'bounty'
                              ) && (
                                  <img
                                      src={getRecordImage(
                                          profileItem,
                                          profileType === 'NETWORK' ? 'allies' : 'bounty'
                                      )}
                                      style={{ width: '150px', height: '150px', objectFit: 'cover', border: '2px solid var(--terminal-red)' }}
                                      alt="Profile"
                                      onError={(e) => {
                                        console.error('Profile image failed:', e.currentTarget.src)
                                        e.currentTarget.style.display = 'none'
                                      }}
                                  />
                              )}
                              <div style={{ flexGrow: 1 }}>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '5px' }}>
                                  {profileType === 'NETWORK' ? profileItem.name : profileItem.target}
                                </div>
                                <div style={{ color: '#aaa', marginBottom: '10px' }}>
                                  {profileType === 'NETWORK' ? profileItem.role : `REWARD: ${profileItem.reward}`}
                                </div>
                                {profileType === 'NETWORK' && profileItem.reward && (
                                    <div style={{ color: 'var(--terminal-red)', fontSize: '0.8rem', marginBottom: '10px', border: '1px solid var(--terminal-red-dim)', padding: '5px', background: 'rgba(255, 49, 49, 0.05)', whiteSpace: 'pre-wrap' }}>
                                      [ REWARDS OBTAINED ]
                                      <br/>
                                      {parseTerminalText(profileItem.reward)}
                                    </div>
                                )}
                                <div className="status-badge" style={{ display: 'inline-block' }}>{profileItem.status}</div>
                                {profileType === 'NETWORK' && (
                                    <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--terminal-red-dim)' }}>
                                      GENERATION: {profileItem.generation || 'GENERATION 1'}
                                    </div>
                                )}
                              </div>
                            </div>

                            <div className="profile-description" style={{
                              border: '1px solid var(--terminal-red-dim)',
                              padding: '15px',
                              background: 'rgba(255, 49, 49, 0.05)',
                              minHeight: '100px',
                              whiteSpace: 'pre-wrap'
                            }}>
                              {parseTerminalText(profileItem.description) || 'NO ADDITIONAL DATA RECORDED.'}
                            </div>

                            {renderComments(profileItem.id)}

                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                              <button className="terminal-button" style={{ flexGrow: 1 }} onClick={() => setShowProfile(false)}>
                                CLOSE PROFILE
                              </button>
                              {isAdmin && (
                                  <button
                                      className="terminal-button"
                                      style={{ background: '#444' }}
                                      onClick={() => {
                                        setShowProfile(false)
                                        openModal(profileType, profileItem)
                                      }}
                                  >
                                    EDIT RECORD
                                  </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                )}

                {showModal && (
                    <div className="modal-overlay">
                      <div className="terminal-window modal-window">
                        <div className="terminal-header">
                          <span>{editItem ? 'UPDATE' : 'CREATE'} {modalType} ENTRY</span>
                          <span onClick={() => setShowModal(false)} style={{ cursor: 'pointer' }}>X</span>
                        </div>
                        <div className="terminal-content">
                          <form className="login-form" onSubmit={handleSave}>
                            {modalType === 'NETWORK' ? (
                                <>
                                  <input
                                      className="terminal-input"
                                      placeholder="NAME"
                                      value={formData.name}
                                      onChange={e => setFormData({...formData, name: e.target.value})}
                                      required
                                  />
                                  <input
                                      className="terminal-input"
                                      placeholder="ROLE"
                                      value={formData.role}
                                      onChange={e => setFormData({...formData, role: e.target.value})}
                                      required
                                  />
                                  <textarea
                                      className="terminal-input"
                                      placeholder="REWARDS GIVEN (MULTILINE)"
                                      style={{ height: '60px', resize: 'none' }}
                                      value={formData.reward}
                                      onChange={e => setFormData({...formData, reward: e.target.value})}
                                  />
                                  <select
                                      className="terminal-input"
                                      value={formData.generation}
                                      onChange={e => setFormData({...formData, generation: e.target.value})}
                                  >
                                    {GENERATIONS.map(gen => (
                                        <option key={gen} value={gen}>{gen}</option>
                                    ))}
                                  </select>
                                </>
                            ) : (
                                <>
                                  <input
                                      className="terminal-input"
                                      placeholder="TARGET"
                                      value={formData.target}
                                      onChange={e => setFormData({...formData, target: e.target.value})}
                                      required
                                  />
                                  <input
                                      className="terminal-input"
                                      placeholder="REWARD (CR)"
                                      value={formData.reward}
                                      onChange={e => setFormData({...formData, reward: e.target.value})}
                                      required
                                  />
                                </>
                            )}
                            <textarea
                                className="terminal-input"
                                placeholder="DESCRIPTION"
                                style={{ height: '80px', resize: 'none' }}
                                value={formData.description}
                                onChange={e => setFormData({...formData, description: e.target.value})}
                            />
                            <select
                                className="terminal-input"
                                value={formData.status}
                                onChange={e => setFormData({...formData, status: e.target.value})}
                            >
                              {modalType === 'NETWORK' ? (
                                  <>
                                    <option value="ACTIVE">ACTIVE</option>
                                    <option value="MIA">MIA</option>
                                    <option value="KIA">KIA</option>
                                    <option value="DECOMMISSIONED">DECOMMISSIONED</option>
                                  </>
                              ) : (
                                  <>
                                    <option value="PENDING">PENDING</option>
                                    <option value="IN_PROGRESS">IN PROGRESS</option>
                                    <option value="COMPLETED">COMPLETED</option>
                                    <option value="CANCELLED">CANCELLED</option>
                                  </>
                              )}
                            </select>
                            <div className="gallery-selector">
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                <span>SELECT IMAGE ({modalType === 'NETWORK' ? 'ALLIES' : 'BOUNTY'}):</span>
                                <span
                                    className="logout-btn"
                                    style={{ padding: '2px 8px', fontSize: '0.6rem', cursor: 'pointer' }}
                                    onClick={() => setFormData({...formData, publicDomainFile: '', imageUrl: ''})}
                                >
                            [ CLEAR SELECTION ]
                          </span>
                              </div>
                              <div className="gallery-grid">
                                {(modalType === 'NETWORK' ? ALLIES_ASSETS : BOUNTY_ASSETS).map(asset => (
                                    <div
                                        key={asset}
                                        className={`gallery-item ${formData.publicDomainFile === asset ? 'active' : ''}`}
                                        onClick={() => setFormData({...formData, publicDomainFile: asset})}
                                    >
                                      <img src={`/${modalType === 'NETWORK' ? 'allies' : 'bounty'}/${asset}`} alt={asset} />
                                      <span className="gallery-label">{asset}</span>
                                    </div>
                                ))}
                              </div>
                            </div>
                            {formData.publicDomainFile && (
                                <div style={{ textAlign: 'center', margin: '5px 0' }}>
                                  <img
                                      src={`/${modalType === 'NETWORK' ? 'allies' : 'bounty'}/${formData.publicDomainFile}`}
                                      style={{ width: '60px', height: '60px', objectFit: 'cover', border: '1px solid var(--terminal-red)' }}
                                      alt="Preview"
                                  />
                                </div>
                            )}
                            <button type="submit" className="terminal-button" disabled={uploading}>
                              {uploading ? 'UPLOADING...' : 'COMMIT CHANGES'}
                            </button>
                            <button type="button" className="terminal-button" style={{ background: '#444' }} onClick={() => setShowModal(false)}>
                              ABORT
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                )}

                {showPinModal && (
                    <div className="modal-overlay">
                      <div className="terminal-window modal-window">
                        <div className="terminal-header">
                          <span>{editPin ? 'EDIT' : 'CREATE'} MAP PIN</span>
                          <span onClick={() => setShowPinModal(false)} style={{ cursor: 'pointer' }}>X</span>
                        </div>
                        <div className="terminal-content">
                          {pinMode === 'VIEW' ? (
                              <div className="pin-view">
                                <div className="terminal-prompt" style={{ fontSize: '1.5rem', borderBottom: '1px solid var(--terminal-red)' }}>
                                  {pinFormData.label}
                                </div>
                                <div style={{ margin: '15px 0', minHeight: '60px', whiteSpace: 'pre-wrap' }}>
                                  {parseTerminalText(pinFormData.description) || 'NO DESCRIPTION PROVIDED.'}
                                </div>
                                {renderComments(editPin?.id)}
                                {getRecordImage(pinFormData, 'public_domain') && (
                                    <div style={{ textAlign: 'center', margin: '15px 0' }}>
                                      <img
                                          src={getRecordImage(pinFormData, 'public_domain')}
                                          style={{ maxWidth: '100%', border: '1px solid var(--terminal-red)', boxShadow: '0 0 10px var(--terminal-red-dim)' }}
                                          alt={pinFormData.label}
                                          onError={(e) => {
                                            console.error('Pin image failed:', e.currentTarget.src)
                                            e.currentTarget.style.display = 'none'
                                          }}
                                      />
                                    </div>
                                )}
                                <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '20px' }}>
                                  RECORDED BY: {editPin?.createdBy || 'UNKNOWN'}
                                </div>
                                <button
                                    className="terminal-button"
                                    style={{ marginTop: '20px', width: '100%' }}
                                    onClick={() => setShowPinModal(false)}
                                >
                                  CLOSE
                                </button>
                                {(isAdmin || (!isGuest && user.email === editPin?.createdBy)) && (
                                    <>
                                      <button
                                          className="terminal-button"
                                          style={{ marginTop: '10px', width: '100%', background: '#444' }}
                                          onClick={() => setPinMode('EDIT')}
                                      >
                                        ENTER EDIT MODE
                                      </button>
                                      <button
                                          className="terminal-button"
                                          style={{ marginTop: '10px', width: '100%', background: '#600' }}
                                          onClick={() => handleDeletePin(editPin.id)}
                                      >
                                        DELETE PIN
                                      </button>
                                    </>
                                )}
                              </div>
                          ) : (
                              <form className="login-form" onSubmit={handleSavePin}>
                                <input
                                    className="terminal-input"
                                    placeholder="LOCATION NAME"
                                    value={pinFormData.label}
                                    onChange={e => setPinFormData({...pinFormData, label: e.target.value})}
                                    required
                                />
                                <textarea
                                    className="terminal-input"
                                    placeholder="DESCRIPTION"
                                    style={{ height: '80px', resize: 'none' }}
                                    value={pinFormData.description}
                                    onChange={e => setPinFormData({...pinFormData, description: e.target.value})}
                                />
                                <div className="gallery-selector">
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                    <span>SELECT PIN ICON (PUBLIC DOMAIN):</span>
                                    <span
                                        className="logout-btn"
                                        style={{ padding: '2px 8px', fontSize: '0.6rem', cursor: 'pointer' }}
                                        onClick={() => setPinFormData({...pinFormData, publicDomainFile: '', imageUrl: ''})}
                                    >
                              [ CLEAR SELECTION ]
                            </span>
                                  </div>
                                  <div className="gallery-grid">
                                    {PUBLIC_DOMAIN_ASSETS.map(asset => (
                                        <div
                                            key={asset}
                                            className={`gallery-item ${pinFormData.publicDomainFile === asset ? 'active' : ''}`}
                                            onClick={() => setPinFormData({...pinFormData, publicDomainFile: asset})}
                                        >
                                          <img src={`/public_domain/${asset}`} alt={asset} />
                                          <span className="gallery-label">{asset}</span>
                                        </div>
                                    ))}
                                  </div>
                                </div>
                                {pinFormData.publicDomainFile && (
                                    <div style={{ textAlign: 'center', margin: '5px 0' }}>
                                      <img
                                          src={`/public_domain/${pinFormData.publicDomainFile}`}
                                          style={{ width: '60px', height: '60px', objectFit: 'cover', border: '1px solid var(--terminal-red)' }}
                                          alt="Preview"
                                      />
                                    </div>
                                )}
                                <button type="submit" className="terminal-button" disabled={uploading}>
                                  {uploading ? 'SAVING...' : 'SAVE PIN'}
                                </button>
                                {editPin && (user.email === editPin.createdBy || isAdmin) && (
                                    <button
                                        type="button"
                                        className="terminal-button"
                                        style={{ background: '#600' }}
                                        onClick={() => handleDeletePin(editPin.id)}
                                    >
                                      DELETE PIN
                                    </button>
                                )}
                                <button type="button" className="terminal-button" style={{ background: '#444' }} onClick={() => setShowPinModal(false)}>
                                  CANCEL
                                </button>
                              </form>
                          )}
                        </div>
                      </div>
                    </div>
                )}
                <div style={{ marginTop: '10px', fontSize: '0.8rem' }}>
                  <span>SYSTEM STATUS: ONLINE | TAB: {activeTab} | USER: {isGuest ? 'SLAB' : user.email?.split('@')[0]}</span>
                  <span className="terminal-cursor"></span>
                </div>
              </>
          )}
        </div>

        {showSystemModal && (
            <div className="modal-overlay" style={{ zIndex: 1000 }}>
              <div className="terminal-window modal-window" style={{ width: '400px' }}>
                <div className="terminal-header">
                  <span>{systemModalConfig.title}</span>
                  <span onClick={() => setShowSystemModal(false)} style={{ cursor: 'pointer' }}>X</span>
                </div>
                <div className="terminal-content">
                  <div style={{ marginBottom: '20px', whiteSpace: 'pre-wrap' }}>{systemModalConfig.message}</div>

                  {systemModalConfig.isInput && (
                      <textarea
                          className="terminal-input"
                          id="system-modal-input"
                          style={{ width: '100%', height: '150px', marginBottom: '20px', resize: 'none' }}
                          defaultValue={systemModalConfig.defaultValue || ''}
                          autoFocus
                      />
                  )}

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        className="terminal-button"
                        style={{ flexGrow: 1 }}
                        onClick={() => {
                          if (systemModalConfig.isInput) {
                            const val = document.getElementById('system-modal-input').value
                            systemModalConfig.onConfirm(val)
                          } else {
                            systemModalConfig.onConfirm()
                          }
                        }}
                    >
                      {systemModalConfig.confirmText}
                    </button>
                    {systemModalConfig.cancelText && (
                        <button
                            className="terminal-button"
                            style={{ flexGrow: 1, background: '#444' }}
                            onClick={systemModalConfig.onCancel}
                        >
                          {systemModalConfig.cancelText}
                        </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
        )}
      </div>
  )
}

export default App