const width = 800;
const height = 500;

const svg = d3.select("#map")
  .attr("width", width)
  .attr("height", height)
  .attr("viewBox", `0 0 ${width} ${height}`)
  .style("overflow", "hidden");

// Fondo visual, no interactivo
svg.append("rect")
  .attr("width", width)
  .attr("height", height)
  .attr("fill", "#fff")
  .attr("pointer-events", "none");

const projection = d3.geoMercator();
const pathGenerator = d3.geoPath().projection(projection);

// Crear un contenedor para las provincias
const mapContainer = svg.append("g").attr("class", "map-layer");

fetch("provinces.geojson")
  .then(res => res.json())
  .then(geojson => {

    projection.fitSize([width, height], geojson);

    // Bind data using ID as key and create one path per feature
    const update = mapContainer.selectAll("path").data(geojson.features, d => d.properties.id);

    // Enter: append paths that draw only the feature interior and stroke
    const entered = update.enter()
      .append("path")
      .attr("d", pathGenerator)
      .attr("data-id", d => d.properties.id)
      .attr("class", d => d.properties.id === 'bg' ? 'background' : 'province')
      .attr("fill", d => d.properties.id === 'bg' ? '#fff' : '#ccc')
      .attr("stroke", "#000")
      .attr("stroke-width", 0.5)
      .attr("fill-opacity", d => d.properties.id === 'bg' ? 1 : 0.7)
      .attr("fill-rule", "evenodd")
      .style("cursor", d => d.properties.id === 'bg' ? 'default' : 'pointer')
      .style("pointer-events", d => d.properties.id === 'bg' ? 'none' : 'auto');

    // Attach interactions only to non-background features
    entered.filter(d => d.properties.id !== 'bg')
      .on("click", function (event, d) {
        event.stopPropagation();

        // Restablecer color de todos los poligonos (excluye bg)
        mapContainer.selectAll("path").filter(p => p && p.properties && p.properties.id !== 'bg').attr("fill", "#ccc");

        // Marcar y traer al frente la provincia clicada
        d3.select(this).attr("fill", "orange").raise();

        console.log("Provincia ID:", d.properties.id, "Nombre:", d.properties.name);
      })
      .on("mouseenter", function (event, d) {
        if (d3.select(this).attr("fill") !== "orange") {
          d3.select(this).attr("fill", "#999");
        }
      })
      .on("mouseleave", function (event, d) {
        if (d3.select(this).attr("fill") !== "orange") {
          d3.select(this).attr("fill", "#ccc");
        }
      });

    // Update: ensure existing paths are updated (in case of re-draw)
    update
      .attr("d", pathGenerator)
      .attr("fill-rule", "evenodd");

    // Remove old elements
    update.exit().remove();
  });
