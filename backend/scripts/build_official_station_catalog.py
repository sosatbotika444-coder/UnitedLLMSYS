from app.official_stations import build_station_catalog, write_catalog_cache


def main():
    stations = build_station_catalog()
    write_catalog_cache(stations)
    print(f"Built official station catalog with {len(stations)} stations.")


if __name__ == "__main__":
    main()


#as manu akm  
#b is conquerrorr ing bikn in the pas t of it so it can be tjhr nbpk n b[ n[v  


