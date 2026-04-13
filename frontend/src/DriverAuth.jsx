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
  return [match?.truckNumber, match?.driverName].filter(Boolean).join(' | ') || 'Motive truck';
}

function fuelLabel(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Fuel not reported';
  return `${Number(value).toFixed(1)}% fuel`;
}

export default function DriverAuth({ mode = 'login', loading = false, onBusyChange, onAuthenticated, onError, onMessage }) {
  const [truckNumber, setTruckNumber] = useState('');
  const [password, setPassword] = useState('');
  const [matches, setMatches] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [matchRetryTick, setMatchRetryTick] = useState(0);

  const trimmedTruckNumber = truckNumber.trim();
  const selectedMatch = useMemo(
    () => matches.find((match) => String(match.vehicleId) === String(selectedVehicleId)) || null,
    [matches, selectedVehicleId]
  );

  useEffect(() => {
    if (trimmedTruckNumber.length < 1) {
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
    }, 350);

    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [matchRetryTick, selectedVehicleId, trimmedTruckNumber]);

  useEffect(() => {
    setMatchRetryTick(0);
  }, [trimmedTruckNumber]);

  useEffect(() => {
    if (trimmedTruckNumber.length < 1 || matches.length || matchError || matchLoading || matchRetryTick >= 8) {
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

    onBusyChange?.(true);
    try {
      const data = await apiRequest(`/driver/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({
          truckNumber: trimmedTruckNumber,
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
          <span>{matchLoading ? 'Searching...' : matches.length ? `${matches.length} found` : 'Type truck number'}</span>
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
              <small>{fuelLabel(match.fuelLevelPercent)} | {match.matched || 'Motive truck profile'}</small>
            </button>
          ))}
          {!matchLoading && trimmedTruckNumber.length >= 1 && !matches.length && !matchError ? (
            <div className='driver-match-empty'>{matchRetryTick < 8 ? 'No Motive truck match yet. Searching again while fleet sync finishes.' : 'No Motive truck match yet.'}</div>
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