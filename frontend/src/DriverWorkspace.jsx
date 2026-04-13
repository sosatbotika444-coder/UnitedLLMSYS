import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import SafetyServiceTools from './SafetyServiceTools';

const RouteAssistant = lazy(() => import('./RouteAssistantUnited'));
const API_URL = import.meta.env.VITE_API_URL || 'https://unitedllmsys-production.up.railway.app/api';
const driverTabs = [
  { id: 'fuel', label: 'Fuel Route' },
  { id: 'service', label: 'Service' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'profile', label: 'Profile' }
];

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

function vehicleLocation(vehicle) {
  const location = vehicle?.location || {};
  return location.address || [location.city, location.state].filter(Boolean).join(', ') || 'Location unavailable';
}

function vehicleFuel(vehicle, match) {
  const location = vehicle?.location || {};
  const value = match?.fuelLevelPercent ?? location.fuel_level_percent ?? location.fuel_primary_remaining_percentage ?? location.fuel_remaining_percentage ?? location.fuel_percentage;
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Not reported';
  return `${Number(value).toFixed(1)}%`;
}

function vehicleStatus(vehicle) {
  if (vehicle?.is_moving) return 'Moving';
  return vehicle?.status || vehicle?.availability_status || 'Ready';
}

function ModuleLoader({ label }) {
  return <div className='module-loader'>{label}</div>;
}

function DriverMetric({ label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`safety-stat-card safety-stat-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function DriverWorkspace({ token, user }) {
  const [activeTab, setActiveTab] = useState('fuel');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setLoading(false);
      return undefined;
    }

    let ignore = false;
    async function loadProfile() {
      setLoading(true);
      setError('');
      try {
        const data = await apiRequest('/driver/profile', {}, token);
        if (!ignore) {
          setProfile(data);
        }
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadProfile();
    return () => {
      ignore = true;
    };
  }, [token]);

  const vehicle = profile?.vehicle || {};
  const match = profile?.match || {};
  const truckNumber = profile?.truckNumber || match.truckNumber || 'Truck';
  const locationLabel = useMemo(() => vehicleLocation(vehicle), [vehicle]);
  const fuelLabel = vehicleFuel(vehicle, match);
  const fixedVehicleId = profile?.vehicleId ? String(profile.vehicleId) : '';

  if (loading) {
    return <ModuleLoader label='Loading driver workspace...' />;
  }

  if (error) {
    return <div className='notice error inline-notice'>{error}</div>;
  }

  return (
    <section className='workspace-content-stack driver-workspace'>
      <section className='safety-fleet-metrics driver-metric-grid'>
        <DriverMetric label='Truck' value={truckNumber} detail={profile?.driverName || user?.full_name || 'Driver'} tone='info' />
        <DriverMetric label='Fuel' value={fuelLabel} detail='Live Motive fuel' tone='warning' />
        <DriverMetric label='Status' value={vehicleStatus(vehicle)} detail='Current vehicle state' tone='dark' />
        <DriverMetric label='Location' value={locationLabel} detail='Route and service center' tone='neutral' />
      </section>

      <div className='workspace-inline-tabs driver-workspace-tabs'>
        {driverTabs.map((tab) => (
          <button
            key={tab.id}
            type='button'
            className={`workspace-inline-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className='workspace-tab-panel' hidden={activeTab !== 'fuel'}>
        <Suspense fallback={<ModuleLoader label='Loading fuel route tools...' />}>
          <RouteAssistant
            token={token}
            active={activeTab === 'fuel'}
            fleetSnapshotOverride={profile?.fleetSnapshot}
            fixedVehicleId={fixedVehicleId}
            lockedVehicle
            driverMode
          />
        </Suspense>
      </section>

      <section className='workspace-tab-panel' hidden={activeTab !== 'service'}>
        <SafetyServiceTools token={token} mode='service' active={activeTab === 'service'} fixedVehicleId={fixedVehicleId} lockedVehicle />
      </section>

      <section className='workspace-tab-panel' hidden={activeTab !== 'emergency'}>
        <SafetyServiceTools token={token} mode='emergency' active={activeTab === 'emergency'} fixedVehicleId={fixedVehicleId} lockedVehicle />
      </section>

      <section className='panel driver-profile-panel workspace-tab-panel' hidden={activeTab !== 'profile'}>
        <div className='panel-head'>
          <div>
            <h2>Driver Profile</h2>
            <span>Motive truck and workspace access.</span>
          </div>
        </div>
        <div className='driver-profile-grid'>
          <div><span>Name</span><strong>{profile?.driverName || user?.full_name || 'Driver'}</strong></div>
          <div><span>Truck</span><strong>{truckNumber}</strong></div>
          <div><span>Fuel</span><strong>{fuelLabel}</strong></div>
          <div><span>Location</span><strong>{locationLabel}</strong></div>
          <div><span>Vehicle ID</span><strong>{fixedVehicleId || '-'}</strong></div>
          <div><span>Emergency</span><strong>Service map ready</strong></div>
        </div>
      </section>
    </section>
  );
}