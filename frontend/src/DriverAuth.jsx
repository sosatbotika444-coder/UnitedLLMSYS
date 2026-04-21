import { useEffect, useMemo, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'https://unitedllmsys-production-f470.up.railway.app/api';

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
  return match?.truckNumber || match?.vehicleLabel || 'Motive truck';
}

export default function DriverAuth({ mode = 'login', loading = false, onBusyChange, onAuthenticated, onError, onMessage }) {
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [password, setPassword] = useState('');
  const [matches, setMatches] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [matchRetryTick, setMatchRetryTick] = useState(0);

  const trimmedTruckNumber = truckNumber.trim();
  const trimmedDriverName = driverName.trim();
  const selectedMatch = useMemo(
    () => matches.find((match) => String(match.vehicleId) === String(selectedVehicleId)) || null,
    [matches, selectedVehicleId]
  );

  useEffect(() => {
    if (trimmedTruckNumber.length < 2) {
      setMatches([]);
      setSelectedVehicleId('');
      setMatchError('');
      setMatchLoading(false);
      setMatchRetryTick(0);
      return undefined;
    }

    let ignore = false;
    const timer = window.setTimeout(async () => {
      setMatchLoading(true);
      setMatchError('');
      try {
        const data = await apiRequest(`/driver/matches?q=${encodeURIComponent(trimmedTruckNumber)}`);
        if (ignore) return;
        setMatches(data || []);
        setSelectedVehicleId((current) => {
          if ((data || []).length === 1) {
            return String(data[0].vehicleId);
          }
          if (current && !(data || []).some((item) => String(item.vehicleId) === String(current))) {
            return '';
          }
          return current;
        });
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
    }, 350);

    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [matchRetryTick, trimmedTruckNumber]);

  useEffect(() => {
    setMatchRetryTick(0);
  }, [trimmedTruckNumber]);

  useEffect(() => {
    if (trimmedTruckNumber.length < 2 || matches.length || matchError || matchLoading || matchRetryTick >= 8) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setMatchRetryTick((current) => current + 1);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [matchError, matchLoading, matchRetryTick, matches.length, trimmedTruckNumber]);

  async function submitDriverAuth(event) {
    event.preventDefault();
    onError?.('');
    onMessage?.('');

    if (!selectedMatch) {
      onError?.('Select your Motive truck first.');
      return;
    }
    if (mode === 'register' && !trimmedDriverName) {
      onError?.('Enter your assigned driver name from Motive.');
      return;
    }

    onBusyChange?.(true);
    try {
      const payload = {
        truckNumber: trimmedTruckNumber,
        password,
        vehicleId: selectedMatch.vehicleId
      };
      if (mode === 'register') {
        payload.driverName = trimmedDriverName;
      }
      const data = await apiRequest(`/driver/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(payload)
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
        Truck Number
        <input
          type='text'
          value={truckNumber}
          onChange={(event) => setTruckNumber(event.target.value)}
          placeholder='Truck number from Motive'
          required
        />
      </label>

      <div className='driver-match-panel'>
        <div className='driver-match-panel-head'>
          <strong>Motive truck match</strong>
          <span>{matchLoading ? 'Searching...' : matches.length ? `${matches.length} found` : 'Type at least 2 characters'}</span>
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
              <span>{match.vehicleLabel || 'Motive vehicle'}</span>
              <small>{match.matched || 'Motive truck profile'}</small>
            </button>
          ))}
          {!matchLoading && trimmedTruckNumber.length >= 2 && !matches.length && !matchError ? (
            <div className='driver-match-empty'>{matchRetryTick < 8 ? 'No Motive truck match yet. Searching again while fleet sync finishes.' : 'No Motive truck match yet.'}</div>
          ) : null}
        </div>
      </div>

      {mode === 'register' ? (
        <label>
          Driver Name
          <input
            type='text'
            value={driverName}
            onChange={(event) => setDriverName(event.target.value)}
            placeholder='Assigned driver name in Motive'
            required
          />
        </label>
      ) : null}

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
