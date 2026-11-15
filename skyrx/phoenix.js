import { createState } from './engine.js';
// Local equirectangular projection: 1 simulation unit = 10 metres.
// A small-area visualization model; not navigation-grade coordinates or routing.
const LAT_ORIGIN = 33.485, LNG_ORIGIN = -112.16, METRES_DEGREE = 111320;
const LNG_SCALE = METRES_DEGREE * Math.cos(33.45 * Math.PI / 180);
export const toPoint = (lat, lng) => ({x:(lng-LNG_ORIGIN)*LNG_SCALE/10,y:(LAT_ORIGIN-lat)*METRES_DEGREE/10,lat,lng});
export const toLatLng = p => [LAT_ORIGIN-p.y*10/METRES_DEGREE,LNG_ORIGIN+p.x*10/LNG_SCALE];
export const SOURCES = {
  stations:'https://www.phoenix.gov/administration/departments/fire/about-us/units-divisions/locations.html',
  stationGIS:'https://maps.phoenix.gov/pub/rest/services/Public/FireStations/MapServer/0',
  parksGIS:'https://maps.phoenix.gov/pub/rest/services/Public/ParksOpenData/MapServer/10',
  historical:'https://www.phoenix.gov/content/dam/phoenix/cityclerksite/city-council-meeting-files/2023/230306001.pdf',
  county:'https://www.maricopa.gov/6205/Overdose-Data'
};
export const LOCATIONS = [
  {name:'Alkire Park vicinity · 85007',...toPoint(33.4350,-112.0965)},
  {name:'Kuban Park vicinity · 85009',...toPoint(33.4401,-112.1280)},
  {name:'University Park vicinity · 85007',...toPoint(33.4518,-112.0880)},
  {name:'Coffelt-Lamoreaux vicinity · 85007',...toPoint(33.4340,-112.1025)}
];
export function createPhoenixState(){
  const s=createState(); s.kmPerUnit=.01; s.handoffRadiusKm=1.8;
  const payloads=['AED','Naloxone kit','Epinephrine kit'];
  s.stations=[
    {id:'ST-03',name:'Phoenix Station 3',short:'Station 3',address:'1257 W. Pierce Street · 85007',...toPoint(33.455829604297094,-112.09067096738204),battery:96,status:'ready',payloads:[...payloads],droneId:'LF-03'},
    {id:'ST-14',name:'Phoenix Station 14',short:'Station 14',address:'1330 N. 32nd Avenue · 85009',...toPoint(33.46387678914284,-112.12736071327583),battery:88,status:'ready',payloads:['AED','Naloxone kit'],droneId:'LF-14'},
    {id:'ST-21',name:'Phoenix Station 21',short:'Station 21',address:'1212 S. 27th Avenue · 85009',...toPoint(33.43632727667144,-112.11749413397165),battery:91,status:'ready',payloads:[...payloads],droneId:'LF-21'}
  ];
  s.zones=[
    {id:'Z-01',name:'Alkire Park',address:'1602 W. Pima Street',...toPoint(33.43363731239186,-112.094087960926),blocked:false},
    {id:'Z-02',name:'Coffelt-Lamoreaux Park',address:'1510 S. 19th Drive',...toPoint(33.43335750848079,-112.10157854595889),blocked:false},
    {id:'Z-03',name:'University Park',address:'1102 W. Van Buren Street',...toPoint(33.45253048578856,-112.08719125935428),blocked:false},
    {id:'Z-04',name:'Kuban Community Park',address:'3275 W. Sherman Street',...toPoint(33.438854182170054,-112.12950000912454),blocked:false}
  ];
  s.incidents=[
    {id:'INC-101',title:'Responder naloxone request',location:LOCATIONS[0].name,...toPoint(LOCATIONS[0].lat,LOCATIONS[0].lng),payload:'Naloxone kit',priority:'urgent',status:'queued',createdAt:0},
    {id:'INC-102',title:'AED delivery request',location:LOCATIONS[1].name,...toPoint(LOCATIONS[1].lat,LOCATIONS[1].lng),payload:'AED',priority:'urgent',status:'queued',createdAt:0},
    {id:'INC-103',title:'Responder supply request',location:LOCATIONS[2].name,...toPoint(LOCATIONS[2].lat,LOCATIONS[2].lng),payload:'Epinephrine kit',priority:'priority',status:'queued',createdAt:0}
  ];
  s.events[0].message='Phoenix training session initialized. Real geography; synthetic calls, aircraft, inventory and conditions. Handoff sites are not approved landing zones.';
  return s;
}
