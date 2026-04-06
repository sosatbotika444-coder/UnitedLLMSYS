from app.official_stations import build_station_catalog, write_catalog_cache


def main():
    stations = build_station_catalog()
    write_catalog_cache(stations)
    print(f"Built official station catalog with {len(stations)} stations.")


if __name__ == "__main__":
    main()
