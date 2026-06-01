const DEFAULT_API_URL = "http://localhost:8000/api";

export const API_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
export const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "";

