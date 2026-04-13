import { useEffect, useMemo, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'https://unitedllmsys-production.up.railway.app/api';

async function apiRequest(path, options = {}, token = '') {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || 'Request failed');
  }

  return data;
}

function matchLabel(match) {
  return [match?.driverName, match?.truckNumber].filter(Boolean).join(' | ') || 'Motive driver';
}

function fuelLabel(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Fuel not reported';
  return `${Number(value).toFixed(1)}% fuel`;
}

export default function DriverAuth({ mode = 'login', loading = false, onBusyChange, onAuthenticated, onError, onMessage }) {
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [matches, setMatches] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');

  const trimmedName = fullName.trim();
  const selectedMatch = useMemo(
    () => matches.find((match) => String(match.vehicleId) === String(selectedVehicleId)) || null,
    [matches, selectedVehicleId]
  );

  useEffect(() => {
    if (trimmedName.length < 2) {
      setMatches([]);
      setSelectedVehicleId('');
      setMatchError('');
      setMatchLoading(false);
      return undefined;
    }

    let ignore = false;
    const timer = window.setTimeout(async () => {
      setMatchLoading(true);
      setMatchError('');
      try {
        const data = await apiRequest(`/driver/matches?q=${encodeURIComponent(trimmedName)}`);
        if (ignore) return;
        setMatches(data || []);
        if ((data || []).length === 1) {
          setSelectedVehicleId(String(data[0].vehicleId));
        } else if (selectedVehicleId && !(data || []).some((item) => String(item.vehicleId) === String(selectedVehicleId))) {
          setSelectedVehicleId('');
        }
      } catch (fetchError) {
        if (!ignore) {
          setMatches([]);
          setSelectedVehicleId('');
          setMatchError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setMatchLoading(false);
        }
      }
    }, 450);

    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [selectedVehicleId, trimmedName]);

  async function submitDriverAuth(event) {
    event.preventDefault();
    onError?.('');
    onMessage?.('');

    if (!selectedMatch) {
      onError?.('Select your Motive driver and truck match first.');
      return;
    }

    onBusyChange?.(true);
    try {
      const data = await apiRequest(`/driver/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({
          fullName: selectedMatch.driverName || trimmedName,
          password,
          vehicleId: selectedMatch.vehicleId
        })
      });
      onAuthenticated?.(data, mode === 'register' ? 'Driver workspace created.' : 'Signed in.');
    } catch (submitError) {
      onError?.(submitError.message);
    } finally {
      onBusyChange?.(false);
    }
  }

  return (
    <form className='auth-form driver-auth-form' onSubmit={submitDriverAuth}>
      <label>
        Driver Name
        <input
          type='text'
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder='Start typing your Motive name'
          required
        />
      </label>

      <div className='driver-match-panel'>
        <div className='driver-match-panel-head'>
          <strong>Motive match</strong>
          <span>{matchLoading ? 'Searching...' : matches.length ? `${matches.length} found` : 'Type at least 2 letters'}</span>
        </div>
        {matchError ? <div className='notice error inline-notice'>{matchError}</div> : null}
        <div className='driver-match-list'>
          {matches.map((match) => (
            <button
              key={match.vehicleId}
              type='button'
              className={`driver-match-card${String(selectedVehicleId) === String(match.vehicleId) ? ' active' : ''}`}
              onClick={() => setSelectedVehicleId(String(match.vehicleId))}
            >
              <strong>{matchLabel(match)}</strong>
              <span>{match.locationLabel || 'Location unavailable'}</span>
              <small>{fuelLabel(match.fuelLevelPercent)} | {match.matched || 'Motive profile'}</small>
            </button>
          ))}
          {!matchLoading && trimmedName.length >= 2 && !matches.length && !matchError ? (
            <div className='driver-match-empty'>No Motive match yet.</div>
          ) : null}
        </div>
      </div>

      <label>
        Password
        <input
          type='password'
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={mode === 'register' ? 'Create password' : 'Enter password'}
          minLength='6'
          required
        />
      </label>

      {selectedMatch ? (
        <div className='driver-auth-selected'>
          <span>Selected</span>
          <strong>{matchLabel(selectedMatch)}</strong>
        </div>
      ) : null}

      <button type='submit' className='primary-button auth-submit' disabled={loading || matchLoading || !selectedMatch}>
        {loading ? 'Working...' : mode === 'register' ? 'Create Driver Workspace' : 'Open Driver Workspace'}
      </button>
    </form>
  );
}