
"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const $ = (id) => document.getElementById(id);

    const form = $("tripForm");
    const originInput = $("origin");
    const destinationInput = $("destination");
    const budgetInput = $("budget");
    const arrivalInput = $("arrive_by");
    const journeyDateInput = $("journey_date");
    const planButton = $("planButton");
    const voiceButton = $("voiceButton");
    const voiceLabel = $("voiceLabel");
    const statusBox = $("status");
    const resultsBox = $("results");
    const routeCount = $("routeCount");
    const mapElement = $("routeMap");
    const mapStatus = $("mapDescription");
    const paymentButton = $("paymentButton");
    const paymentStatus = $("paymentStatus");

    if (
        !form || !originInput || !destinationInput ||
        !budgetInput || !arrivalInput || !resultsBox
    ) {
        console.error("RoamAgent: Required HTML elements are missing.");
        return;
    }

    // Sample schedules for the MVP. These are not live bus services.
    const routes = [
        {
            id: "BUS102",
            origin: "Visakhapatnam",
            destination: "Hyderabad",
            departure: "21:00",
            arrival: "08:30",
            duration: "11h 30m",
            type: "Sleeper",
            fare: 650,
            operator: "Sample Bus Service"
        },
        {
            id: "BUS103",
            origin: "Visakhapatnam",
            destination: "Hyderabad",
            departure: "20:30",
            arrival: "07:45",
            duration: "11h 15m",
            type: "Seater",
            fare: 720,
            operator: "Sample Express"
        },
        {
            id: "BUS201",
            origin: "Hyderabad",
            destination: "Visakhapatnam",
            departure: "20:00",
            arrival: "07:30",
            duration: "11h 30m",
            type: "Sleeper",
            fare: 690,
            operator: "Sample Bus Service"
        },
        {
            id: "BUS301",
            origin: "Hyderabad",
            destination: "Bengaluru",
            departure: "21:00",
            arrival: "06:30",
            duration: "9h 30m",
            type: "Sleeper",
            fare: 800,
            operator: "Sample South Travels"
        },
        {
            id: "BUS401",
            origin: "Bengaluru",
            destination: "Chennai",
            departure: "22:00",
            arrival: "05:30",
            duration: "7h 30m",
            type: "Seater",
            fare: 550,
            operator: "Sample City Connect"
        },
        {
            id: "BUS501",
            origin: "Hyderabad",
            destination: "Vijayawada",
            departure: "22:30",
            arrival: "05:00",
            duration: "6h 30m",
            type: "Seater",
            fare: 500,
            operator: "Sample Regional Travels"
        },
        {
            id: "BUS601",
            origin: "Chennai",
            destination: "Bengaluru",
            departure: "23:00",
            arrival: "06:00",
            duration: "7h",
            type: "Sleeper",
            fare: 600,
            operator: "Sample Night Express"
        }
    ];

    const cityCoordinates = {
        "visakhapatnam": [17.6868, 83.2185],
        "hyderabad": [17.3850, 78.4867],
        "bengaluru": [12.9716, 77.5946],
        "chennai": [13.0827, 80.2707],
        "vijayawada": [16.5062, 80.6480]
    };

    let map = null;
    let routeLayer = null;
    let latestMapRequest = 0;

    function normalize(value) {
        return String(value || "")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }

    function setStatus(message) {
        if (statusBox) statusBox.textContent = message;
    }

    function setMapStatus(message) {
        if (mapStatus) mapStatus.textContent = message;
    }

    function timeToMinutes(value) {
        const match = /^(\d{2}):(\d{2})$/.exec(value || "");
        if (!match) return null;

        const hours = Number(match[1]);
        const minutes = Number(match[2]);

        if (hours > 23 || minutes > 59) return null;
        return hours * 60 + minutes;
    }

    function formatDuration(minutes) {
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return `${hours}h ${String(remainder).padStart(2, "0")}m`;
    }

    function getRouteTiming(route, deadline) {
        const departure = timeToMinutes(route.departure);
        const arrivalClock = timeToMinutes(route.arrival);

        if (departure === null || arrivalClock === null) return null;

        // If arrival is at or before departure, treat it as next day.
        const arrival = arrivalClock <= departure
            ? arrivalClock + 1440
            : arrivalClock;

        // Interpret an earlier deadline as the next occurrence after departure.
        const deadlineMinutes = deadline <= departure
            ? deadline + 1440
            : deadline;

        return {
            departure,
            arrival,
            deadline: deadlineMinutes,
            duration: arrival - departure,
            meetsDeadline: arrival <= deadlineMinutes
        };
    }

    function validateJourneyDate() {
        if (!journeyDateInput || !journeyDateInput.value) {
            return { valid: true, message: "" };
        }

        const chosen = journeyDateInput.value;
        const now = new Date();
        const today = new Date(
            now.getTime() - now.getTimezoneOffset() * 60000
        ).toISOString().slice(0, 10);

        if (chosen < today) {
            return {
                valid: false,
                message: "Please select today or a future journey date."
            };
        }

        return { valid: true, message: "" };
    }

    // Keep the date input in local time, not UTC.
    if (journeyDateInput) {
        const now = new Date();
        const today = new Date(
            now.getTime() - now.getTimezoneOffset() * 60000
        ).toISOString().slice(0, 10);

        journeyDateInput.min = today;
        if (!journeyDateInput.value) journeyDateInput.value = today;
    }

    // Safe, simulated PayPilot interaction.
    if (paymentButton && paymentStatus) {
        paymentButton.addEventListener("click", () => {
            paymentStatus.textContent =
                "PayPilot simulation: no payment was initiated. " +
                "Real transactions require user approval and an authorised gateway.";
        });
    }

    // Interactive Leaflet map.
    function initializeMap() {
        if (!mapElement) {
            console.warn("RoamAgent: #routeMap was not found.");
            return;
        }

        if (!window.L) {
            setMapStatus("Map library unavailable. Check your internet connection.");
            return;
        }

        map = L.map(mapElement).setView([17.7, 81.0], 6);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);

        routeLayer = L.layerGroup().addTo(map);
        setMapStatus("Enter your cities to display the geographic route.");

        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 300);
    }

    async function findCity(city) {
        // Prefer known coordinates for the supported sample cities.
        const known = cityCoordinates[normalize(city)];
        if (known) return { lat: known[0], lon: known[1] };

        const url =
            "https://nominatim.openstreetmap.org/search" +
            "?format=jsonv2&limit=1&q=" +
            encodeURIComponent(city + ", India");

        const response = await fetch(url);
        if (!response.ok) throw new Error("City lookup is unavailable.");

        const locations = await response.json();
        if (!locations.length) throw new Error("City not found: " + city);

        return {
            lat: Number(locations[0].lat),
            lon: Number(locations[0].lon)
        };
    }

    async function findRoadRoute(start, end) {
        const url =
            "https://router.project-osrm.org/route/v1/driving/" +
            `${start.lon},${start.lat};${end.lon},${end.lat}` +
            "?overview=full&geometries=geojson";

        const response = await fetch(url);
        if (!response.ok) throw new Error("Road routing is unavailable.");

        const data = await response.json();
        if (data.code !== "Ok" || !data.routes?.length) {
            throw new Error("No road geometry returned.");
        }

        return data.routes[0];
    }

    async function updateMap(origin, destination) {
        if (!map || !routeLayer) return;

        const requestId = ++latestMapRequest;
        setMapStatus(`Loading geographic route: ${origin} → ${destination}`);

        try {
            const start = await findCity(origin);
            if (requestId !== latestMapRequest) return;

            const end = await findCity(destination);
            if (requestId !== latestMapRequest) return;

            routeLayer.clearLayers();

            L.marker([start.lat, start.lon])
                .bindPopup("Starting city: " + origin)
                .addTo(routeLayer);

            L.marker([end.lat, end.lon])
                .bindPopup("Destination: " + destination)
                .addTo(routeLayer);

            try {
                const road = await findRoadRoute(start, end);
                if (requestId !== latestMapRequest) return;

                const points = road.geometry.coordinates.map(
                    ([lon, lat]) => [lat, lon]
                );

                L.polyline(points, {
                    color: "#65d8ff",
                    weight: 5,
                    opacity: 0.9
                }).addTo(routeLayer);

                map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });

                setMapStatus(
                    `Geographic road route: ${(road.distance / 1000).toFixed(1)} km. ` +
                    "This is not a live bus route or tracking feed."
                );
            } catch (error) {
                if (requestId !== latestMapRequest) return;

                const points = [
                    [start.lat, start.lon],
                    [end.lat, end.lon]
                ];

                L.polyline(points, {
                    color: "#64748b",
                    weight: 4,
                    dashArray: "8, 8"
                }).addTo(routeLayer);

                map.fitBounds(points, { padding: [30, 30] });
                setMapStatus(
                    "Road geometry unavailable. Showing a straight-line city connection."
                );
                console.warn("Road routing:", error);
            }
        } catch (error) {
            if (requestId !== latestMapRequest) return;

            setMapStatus(
                "Could not load the map route. Check the city names and internet connection."
            );
            console.error("Map lookup:", error);
        }
    }

    function createParagraph(text) {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
    }

    let selectedBookingRoute = null;
function displayRoutes(foundRoutes) {
    resultsBox.replaceChildren();

    if (routeCount) {
        routeCount.textContent =
            `${foundRoutes.length} OPTION${foundRoutes.length === 1 ? "" : "S"}`;
    }

    // Create a conversational explanation from the actual planner results.
    const agentMessage = document.createElement("article");
    agentMessage.className = "route-card agent-message";

    const agentHeading = document.createElement("h3");
    agentHeading.textContent = "RoamAgent Travel Briefing";
    agentMessage.appendChild(agentHeading);

    if (!foundRoutes.length) {
        agentMessage.appendChild(createParagraph(
            "I couldn't find a sample bus that satisfies all your requirements. " +
            "Let's adjust your budget or arrival deadline and try again."
        ));

        agentMessage.appendChild(createParagraph(
            "Important: I use sample schedules in this prototype, not live bus availability."
        ));

        resultsBox.appendChild(agentMessage);
        resultsBox.appendChild(createParagraph(
            "Try increasing your budget, adjusting your arrival deadline, " +
            "or selecting a supported sample route."
        ));
        return;
    }

    const best = foundRoutes[0];
    const bestRoute = best.route;

    agentMessage.appendChild(createParagraph(
        `I've compared ${foundRoutes.length} suitable sample ` +
        `${foundRoutes.length === 1 ? "option" : "options"} for ` +
        `${bestRoute.origin} to ${bestRoute.destination}. ` +
        `My top recommendation is ${bestRoute.id}, departing at ` +
        `${bestRoute.departure} and arriving at ${bestRoute.arrival}, ` +
        `for ₹${bestRoute.fare}.`
    ));

    const reasonsHeading = document.createElement("h4");
    reasonsHeading.textContent = "Why I recommend this option";
    agentMessage.appendChild(reasonsHeading);

    best.reasons.forEach(reason => {
        agentMessage.appendChild(createParagraph("• " + reason));
    });

    if (foundRoutes.length > 1) {
        const alternative = foundRoutes[1];
        const alternativeRoute = alternative.route;

        const fareDifference = alternativeRoute.fare - bestRoute.fare;

        const tradeoffHeading = document.createElement("h4");
        tradeoffHeading.textContent = "Alternative and trade-off";
        agentMessage.appendChild(tradeoffHeading);

        let tradeoff;

        if (fareDifference > 0) {
            tradeoff =
                `${alternativeRoute.id} costs ₹${fareDifference} more`;
        } else if (fareDifference < 0) {
            tradeoff =
                `${alternativeRoute.id} costs ₹${Math.abs(fareDifference)} less`;
        } else {
            tradeoff = `${alternativeRoute.id} has the same fare`;
        }

        tradeoff +=
            `. It departs at ${alternativeRoute.departure} and ` +
            `arrives at ${alternativeRoute.arrival}. `;

        if (alternative.timing.duration < best.timing.duration) {
            tradeoff +=
                `It saves ${formatDuration(
                    best.timing.duration - alternative.timing.duration
                )} in journey time compared with my top recommendation.`;
        } else if (alternative.timing.duration > best.timing.duration) {
            tradeoff +=
                `It takes ${formatDuration(
                    alternative.timing.duration - best.timing.duration
                )} longer than my top recommendation.`;
        } else {
            tradeoff += "Both options have the same journey duration.";
        }

        agentMessage.appendChild(createParagraph(tradeoff));
    }

    agentMessage.appendChild(createParagraph(
        "Decision method: I use transparent, rule-based scoring of fare, " +
        "arrival deadline and journey duration. This score is not an AI " +
        "confidence percentage, and these sample schedules are not live availability."
    ));

    resultsBox.appendChild(agentMessage);

    // Display each recommended route.
    foundRoutes.forEach((item, index) => {
        const { route, timing, reasons, score } = item;

        const card = document.createElement("article");
        card.className = "route-card journey";

        const heading = document.createElement("h3");
        heading.textContent =
            `${index === 0 ? "Recommended choice" : "Alternative option " + (index + 1)}: ` +
            `${route.origin} → ${route.destination}`;
        card.appendChild(heading);

        card.appendChild(createParagraph(
            `${route.departure} departure → ${route.arrival} arrival`
        ));

        card.appendChild(createParagraph(
            `Estimated journey duration: ${formatDuration(timing.duration)}`
        ));

        card.appendChild(createParagraph(`Bus type: ${route.type}`));
        card.appendChild(createParagraph(`Operator: ${route.operator}`));
        card.appendChild(createParagraph(`Sample service ID: ${route.id}`));

        const fare = document.createElement("p");
        fare.className = "fare";
        fare.textContent = `₹${route.fare}`;
        card.appendChild(fare);
        const selectButton = document.createElement("button");
selectButton.type = "button";
selectButton.className = "primary-button";
selectButton.textContent = "Select This Bus";

selectButton.addEventListener("click", () => {
    selectedBookingRoute = item;
    const bookingSummary = document.getElementById("bookingSummary");

    if (bookingSummary) {
        bookingSummary.textContent =
            `${route.origin} → ${route.destination} | ` +
            `${route.id} | ${route.departure}–${route.arrival} | ` +
            `Fare: ₹${route.fare}`;
    }

    const bookingDetails = document.getElementById("bookingDetails");
    const paymentButton = document.getElementById("paymentButton");
    const paymentStatus = document.getElementById("paymentStatus");

    if (bookingDetails) bookingDetails.replaceChildren();
    if (paymentButton) paymentButton.hidden = true;

    if (paymentStatus) {
        paymentStatus.textContent =
            "Bus selected. Click Review Booking to continue.";
    }
});

card.appendChild(selectButton);
        const explanation = document.createElement("p");
        explanation.className = "route-explanation";
        explanation.textContent = "Why this option: " + reasons.join(" ");
        card.appendChild(explanation);

        const scoreLabel = document.createElement("p");
        scoreLabel.className = "route-score";
        scoreLabel.textContent = `Rule-based planning score: ${score}/100`;
        card.appendChild(scoreLabel);

        resultsBox.appendChild(card);
    });
}


    function evaluateRoute(route, budget, deadline) {
        const timing = getRouteTiming(route, deadline);
        if (!timing) return null;

        const withinBudget = route.fare <= budget;
        const reasons = [];

        if (withinBudget) {
            reasons.push(`Fits your ₹${budget} budget.`);
        } else {
            reasons.push(`Exceeds your budget by ₹${route.fare - budget}.`);
        }

        if (timing.meetsDeadline) {
            reasons.push(`Arrives before your ${arrivalInput.value} deadline.`);
        } else {
            reasons.push(`Misses your arrival deadline by ${formatDuration(
                timing.arrival - timing.deadline
            )}.`);
        }

        reasons.push(`Journey duration is ${formatDuration(timing.duration)}.`);

        // A transparent rule-based score, not an AI confidence percentage.
        const budgetScore = withinBudget
            ? Math.max(0, 40 - (route.fare / budget) * 20)
            : 0;

        const deadlineScore = timing.meetsDeadline ? 40 : 0;
        const durationScore = Math.max(0, 20 - timing.duration / 60);

        const score = Math.round(
            Math.max(0, Math.min(100, budgetScore + deadlineScore + durationScore))
        );

        return {
            route,
            timing,
            reasons,
            score,
            withinBudget,
            meetsDeadline: timing.meetsDeadline
        };
    }

    function planJourney() {
        const origin = originInput.value.trim();
        const destination = destinationInput.value.trim();
        const budgetText = budgetInput.value.trim();
        const budget = Number(budgetText);
        const deadline = timeToMinutes(arrivalInput.value);
        const dateCheck = validateJourneyDate();

        if (!origin || !destination) {
            setStatus("Please enter both the starting city and destination.");
            return;
        }

        if (normalize(origin) === normalize(destination)) {
            setStatus("Starting city and destination must be different.");
            return;
        }

        if (!budgetText || !Number.isFinite(budget) || budget <= 0) {
            setStatus("Enter a valid budget greater than ₹0.");
            return;
        }

        if (deadline === null) {
            setStatus("Please select a valid arrival deadline.");
            return;
        }

        if (!dateCheck.valid) {
            setStatus(dateCheck.message);
            return;
        }

        if (planButton) {
            planButton.disabled = true;
            planButton.textContent = "Planning...";
        }

        setStatus("RoamAgent is evaluating routes, budget, arrival time and duration...");
        resultsBox.textContent = "Evaluating sample routes...";

        updateMap(origin, destination);

        const matchingRoutes = routes.filter(route =>
            normalize(route.origin) === normalize(origin) &&
            normalize(route.destination) === normalize(destination)
        );

        const evaluated = matchingRoutes
            .map(route => evaluateRoute(route, budget, deadline))
            .filter(Boolean);

        const suitable = evaluated
            .filter(item => item.withinBudget && item.meetsDeadline)
            .sort((a, b) => b.score - a.score || a.route.fare - b.route.fare);

        displayRoutes(suitable);

        if (suitable.length) {
            setStatus(
                `Found ${suitable.length} suitable sample route(s). ` +
                "Recommendations use rule-based scoring, not live availability."
            );
        } else if (matchingRoutes.length) {
            const budgetFits = evaluated.some(item => item.withinBudget);
            const deadlineFits = evaluated.some(item => item.meetsDeadline);

            let reason = "No route satisfies both constraints.";
            if (!budgetFits && !deadlineFits) {
                reason = "Sample routes exceed your budget and miss your deadline.";
            } else if (!budgetFits) {
                reason = "Sample routes arrive in time, but exceed your budget.";
            } else if (!deadlineFits) {
                reason = "Sample routes fit your budget, but miss your arrival deadline.";
            }

            setStatus(reason + " Adjust your preferences and try again.");
        } else {
            setStatus(
                `No sample bus data is available for ${origin} → ${destination}. ` +
                "The map may still display the geographic connection."
            );
        }

        if (planButton) {
            planButton.disabled = false;
            planButton.textContent = "Plan My Journey";
        }
    }

    form.addEventListener("submit", event => {
        event.preventDefault();
        planJourney();
    });

    
    // STAGE 4: BOOKING AND PAYPILOT DEMO
    const bookingButton = $("bookingButton");
    const bookingDetails = $("bookingDetails");

    // Remember the selected sample route from the route cards.
    // selectedBookingRoute is declared above displayRoutes().
    
    // Review booking
    if (bookingButton) {
        bookingButton.addEventListener("click", function () {
            if (!selectedBookingRoute) {
                paymentStatus.textContent =
                    "Please plan your journey and select a bus first.";
                return;
            }

            const route = selectedBookingRoute.route;

            bookingDetails.replaceChildren();

            const title = document.createElement("h3");
            title.textContent = "Review Your Booking";
            bookingDetails.appendChild(title);

            const details = [
                "Route: " + route.origin + " → " + route.destination,
                "Sample service: " + route.id,
                "Departure: " + route.departure,
                "Arrival: " + route.arrival,
                "Bus type: " + route.type,
                "Operator: " + route.operator,
                "Total demo fare: ₹" + route.fare
            ];

            details.forEach(function (text) {
                const p = document.createElement("p");
                p.textContent = text;
                bookingDetails.appendChild(p);
            });

            const note = document.createElement("p");
            note.textContent =
                "Demo only. No real ticket has been reserved.";
            bookingDetails.appendChild(note);

            paymentButton.hidden = false;
            paymentButton.disabled = false;
            paymentButton.textContent = "Simulate PayPilot Payment";

            paymentStatus.textContent =
                "Booking summary ready. Review it before continuing.";
        });
    }

    // Simulate PayPilot payment status
    if (paymentButton) {
        paymentButton.addEventListener("click", function () {
            if (!selectedBookingRoute) {
                paymentStatus.textContent =
                    "Please select a sample bus first.";
                return;
            }

            const route = selectedBookingRoute.route;
            const reference =
                "DEMO-" + route.id + "-" +
                Date.now().toString().slice(-6);

            bookingDetails.replaceChildren();

            const title = document.createElement("h3");
            title.textContent = "Demo Booking Confirmation";
            bookingDetails.appendChild(title);

            const confirmation = [
                "Demo reference: " + reference,
                "Journey: " + route.origin + " → " + route.destination,
                "Sample service: " + route.id,
                "Departure: " + route.departure,
                "Arrival: " + route.arrival,
                "Fare shown: ₹" + route.fare,
                "Payment status: SIMULATED — NOT PAID",
                "Ticket status: NOT BOOKED"
            ];

            confirmation.forEach(function (text) {
                const p = document.createElement("p");
                p.textContent = text;
                bookingDetails.appendChild(p);
            });

            paymentStatus.textContent =
                "PayPilot demo completed. No real payment was processed.";

            paymentButton.disabled = true;
            paymentButton.textContent = "Demo Completed";
        });
    }

    
    // Stage 3: Simulated disruption recovery agent.
    const disruptionTypeInput = $("disruptionType");
    const recoveryButton = $("recoveryButton");
    const recoveryStatus = $("recoveryStatus");
    const recoveryResults = $("recoveryResults");

    function formatRecoveryTime(totalMinutes) {
        const clock = ((totalMinutes % 1440) + 1440) % 1440;
        const hours = Math.floor(clock / 60);
        const minutes = clock % 60;
        const nextDay = totalMinutes >= 1440 ? " (next day)" : "";

        return String(hours).padStart(2, "0") + ":" +
            String(minutes).padStart(2, "0") + nextDay;
    }

    function recoveryParagraph(message) {
        const paragraph = document.createElement("p");
        paragraph.textContent = message;
        recoveryResults.appendChild(paragraph);
    }

    function runRecoveryAgent() {
        if (!disruptionTypeInput || !recoveryStatus || !recoveryResults) {
            setStatus("Recovery controls are missing. Check index.html.");
            return;
        }

        recoveryResults.replaceChildren();

        const origin = originInput.value.trim();
        const destination = destinationInput.value.trim();
        const budget = Number(budgetInput.value);
        const deadline = timeToMinutes(arrivalInput.value);

        if (
            !origin || !destination ||
            normalize(origin) === normalize(destination) ||
            !budgetInput.value.trim() ||
            !Number.isFinite(budget) || budget <= 0 ||
            deadline === null
        ) {
            recoveryStatus.textContent =
                "Enter valid cities, a budget and an arrival deadline first.";
            return;
        }

        const matchingRoutes = routes.filter(route =>
            normalize(route.origin) === normalize(origin) &&
            normalize(route.destination) === normalize(destination)
        );

        if (!matchingRoutes.length) {
            recoveryStatus.textContent =
                "No sample services found for this city pair.";
            recoveryParagraph(
                "Try a supported sample route. The map can still show the geographic connection."
            );
            return;
        }

        const evaluated = matchingRoutes
            .map(route => evaluateRoute(route, budget, deadline))
            .filter(Boolean);

        const affordable = evaluated
            .filter(item => item.withinBudget)
            .sort((a, b) => b.score - a.score || a.route.fare - b.route.fare);

        if (!affordable.length) {
            recoveryStatus.textContent =
                "No sample service fits your budget.";
            recoveryParagraph(
                "Increase your budget and run the recovery simulation again."
            );
            return;
        }

        const affected =
            affordable.find(item => item.meetsDeadline) || affordable[0];

        const alternatives = affordable.filter(
            item => item.route.id !== affected.route.id
        );

        if (disruptionTypeInput.value === "delay") {
            const revisedArrival = affected.timing.arrival + 60;
            const meetsDeadline = revisedArrival <= affected.timing.deadline;

            recoveryStatus.textContent =
                "Simulated disruption: 60-minute bus delay.";

            const heading = document.createElement("h3");
            heading.textContent = "Delay impact assessment";
            recoveryResults.appendChild(heading);

            recoveryParagraph(`Affected sample service: ${affected.route.id}.`);
            recoveryParagraph(
                `Original arrival: ${formatRecoveryTime(affected.timing.arrival)}.`
            );
            recoveryParagraph(
                `Revised arrival: ${formatRecoveryTime(revisedArrival)}.`
            );
            recoveryParagraph(
                meetsDeadline
                    ? "The delayed bus still meets your arrival deadline."
                    : "The delayed bus misses your arrival deadline."
            );

            const alternative = alternatives.find(
                item => item.meetsDeadline
            ) || alternatives[0];

            if (alternative) {
                const subheading = document.createElement("h3");
                subheading.textContent = "Suggested recovery option";
                recoveryResults.appendChild(subheading);

                recoveryParagraph(
                    `${alternative.route.id}: departs at ${alternative.route.departure}, ` +
                    `arrives at ${alternative.route.arrival}, fare ₹${alternative.route.fare}.`
                );

                recoveryParagraph(
                    alternative.meetsDeadline
                        ? "This alternative fits your budget and arrival deadline."
                        : "This alternative fits your budget but misses your original deadline."
                );
            } else {
                recoveryParagraph(
                    "No other affordable sample service was found. " +
                    "Consider changing your budget or deadline."
                );
            }
        } else if (disruptionTypeInput.value === "missed") {
            recoveryStatus.textContent =
                "Simulated disruption: missed connecting bus.";

            const heading = document.createElement("h3");
            heading.textContent = "Missed-connection recovery";
            recoveryResults.appendChild(heading);

            recoveryParagraph(
                `Affected sample itinerary: ${affected.route.id}, ` +
                `${origin} to ${destination}.`
            );

            recoveryParagraph(
                "The current prototype has direct sample routes, not real multi-leg " +
                "transfer schedules. These recovery options are simulations."
            );

            if (alternatives.length) {
                const subheading = document.createElement("h3");
                subheading.textContent = "Alternative sample services";
                recoveryResults.appendChild(subheading);

                alternatives.forEach(item => {
                    recoveryParagraph(
                        `${item.route.id}: ${item.route.departure}–${item.route.arrival}, ` +
                        `₹${item.route.fare}. ` +
                        (item.meetsDeadline
                            ? "Fits your budget and deadline."
                            : "Fits your budget but misses your deadline.")
                    );
                });
            } else {
                recoveryParagraph(
                    "No other affordable sample service is available for this city pair."
                );
            }

            recoveryParagraph(
                "For a real journey, confirm availability, transfer feasibility, " +
                "refund rules and any extra fare with the transport provider."
            );
        } else {
            recoveryStatus.textContent =
                "Please choose a supported disruption scenario.";
        }
    }

    if (recoveryButton) {
        recoveryButton.addEventListener("click", runRecoveryAgent);
    }
// Voice input: populate form fields, then reuse the same planner.
    if (voiceButton) {
        voiceButton.addEventListener("click", () => {
            const SpeechRecognition =
                window.SpeechRecognition || window.webkitSpeechRecognition;

            if (!SpeechRecognition) {
                const message = "Voice recognition is unavailable. Try a supported version of Chrome.";
                if (voiceLabel) voiceLabel.textContent = message;
                setStatus(message);
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.lang = "en-IN";
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            voiceButton.disabled = true;
            if (voiceLabel) voiceLabel.textContent = "Listening...";
            setStatus("Try: From Visakhapatnam to Hyderabad under 800, arrive by 9 AM.");

            recognition.onresult = event => {
                const spoken = event.results[0][0].transcript.trim();
                const text = spoken.toLowerCase();

                const routeMatch = text.match(
                    /(?:from\s+)?(.+?)\s+to\s+(.+?)(?=\s+(?:under|budget|for|arrive|reach|by)\b|$)/i
                );

                if (routeMatch) {
                    originInput.value = routeMatch[1].trim();
                    destinationInput.value = routeMatch[2].trim();
                }

                const budgetMatch =
                    text.match(/(?:under|budget(?:\s+of)?|maximum(?:\s+of)?|below)\s*(?:₹|rs\.?\s*)?(\d+)/i) ||
                    text.match(/(?:₹|rs\.?\s*)(\d+)/i) ||
                    text.match(/(\d+)\s*(?:rupees|rs\.?)/i);

                if (budgetMatch) budgetInput.value = budgetMatch[1];

                const timeMatch = text.match(
                    /(?:arrive|reach|get there)\s+(?:by\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
                );

                if (timeMatch) {
                    let hours = Number(timeMatch[1]);
                    const minutes = Number(timeMatch[2] || 0);
                    const meridiem = (timeMatch[3] || "").toLowerCase();

                    if (meridiem === "pm" && hours < 12) hours += 12;
                    if (meridiem === "am" && hours === 12) hours = 0;

                    if (hours <= 23 && minutes <= 59) {
                        arrivalInput.value =
                            String(hours).padStart(2, "0") + ":" +
                            String(minutes).padStart(2, "0");
                    }
                }

                const dateMatch = spoken.match(
                    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
                );

                if (dateMatch && journeyDateInput) {
                    const months = [
                        "january", "february", "march", "april",
                        "may", "june", "july", "august",
                        "september", "october", "november", "december"
                    ];

                    const day = Number(dateMatch[1]);
                    const month = months.indexOf(dateMatch[2].toLowerCase());
                    const year = Number(dateMatch[3]);
                    const date = new Date(year, month, day);

                    if (
                        date.getFullYear() === year &&
                        date.getMonth() === month &&
                        date.getDate() === day
                    ) {
                        const value =
                            `${year}-${String(month + 1).padStart(2, "0")}-` +
                            String(day).padStart(2, "0");

                        if (!journeyDateInput.min || value >= journeyDateInput.min) {
                            journeyDateInput.value = value;
                        }
                    }
                }

                if (voiceLabel) voiceLabel.textContent = "Recognised: " + spoken;

                if (!originInput.value.trim() || !destinationInput.value.trim()) {
                    setStatus("Speech received. Check the starting city and destination, then try again.");
                    return;
                }

                planJourney();
            };

            recognition.onerror = event => {
                const messages = {
                    "not-allowed": "Allow microphone access in browser settings.",
                    "no-speech": "No speech detected. Please try again.",
                    "audio-capture": "No microphone detected.",
                    "network": "Speech recognition requires internet access."
                };

                const message = messages[event.error] ||
                    `Voice recognition failed: ${event.error}`;

                if (voiceLabel) voiceLabel.textContent = message;
                setStatus(message);
            };

            recognition.onend = () => {
                voiceButton.disabled = false;
            };

            try {
                recognition.start();
            } catch (error) {
                voiceButton.disabled = false;
                setStatus("Could not start the microphone. Refresh and retry.");
                console.error(error);
            }
        });
    }

    initializeMap();
    console.log("TBS RoamAgent initialized successfully.");
});
