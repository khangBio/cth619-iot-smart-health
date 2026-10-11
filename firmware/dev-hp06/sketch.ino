#include <WiFi.h>
#include <HTTPClient.h>
#include <MQTT.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>
#include <time.h>
#include <sys/time.h>
#include "config.h"

#ifndef TIME_SYNC_URL
#error "Define TIME_SYNC_URL in config.h (http://host.wokwi.internal:<API host port>/api/time)"
#endif

WiFiClient network;
MQTTClient mqtt(6144);
OneWire oneWire(4);
DallasTemperature thermometer(&oneWire);
Adafruit_MPU6050 motionSensor;
String assignmentId=INITIAL_ASSIGNMENT, patientId=INITIAL_PATIENT, encounterId=INITIAL_ENCOUNTER;
String lampMode="off", lastCommand="", bootId, pendingAck="", lastIssuedText="";
unsigned long sequence=0, lastSample=0, lastConnect=0, lastPress=0;
bool motionReady=false, previousButton=HIGH;
time_t lastIssued=0;
const int RED_PIN=25, GREEN_PIN=26, BLUE_PIN=27, BUTTON_PIN=13;

String timestamp() {
  time_t now=time(nullptr); struct tm utc; gmtime_r(&now,&utc);
  char text[28]; strftime(text,sizeof(text),"%Y-%m-%dT%H:%M:%S.000Z",&utc); return String(text);
}
bool synchronizeClock() {
  // Synchronize for every acquisition: simulated seconds may take many real
  // seconds. Periodic NTP alone cannot bound drift under a slow simulation.
  WiFiClient timeNetwork;
  HTTPClient http;
  http.setConnectTimeout(2000);http.setTimeout(2000);
  if(!http.begin(timeNetwork,TIME_SYNC_URL))return false;
  int status=http.GET();JsonDocument response;
  bool valid=status==200 && !deserializeJson(response,http.getStream());
  int64_t epoch=valid ? response["epoch_ms"].as<int64_t>() : 0;
  http.end();
  if(epoch<1700000000000LL){Serial.println("TIME SYNC failed; no fresh sample published. Check TIME_SYNC_URL / API.");return false;}
  struct timeval tv;tv.tv_sec=epoch/1000;tv.tv_usec=(epoch%1000)*1000;
  settimeofday(&tv,nullptr);
  return true;
}
time_t parseTime(const char* text) {
  struct tm t={}; int y,m,d,h,n,s;
  if(sscanf(text,"%d-%d-%dT%d:%d:%d",&y,&m,&d,&h,&n,&s)!=6)return 0;
  t.tm_year=y-1900;t.tm_mon=m-1;t.tm_mday=d;t.tm_hour=h;t.tm_min=n;t.tm_sec=s;
  return mktime(&t); // TZ is UTC, set in setup().
}
void setLamp() {
  bool red=lampMode=="red" || (lampMode=="red_blink" && (millis()/400)%2==0);
  bool yellow=lampMode=="yellow";
  digitalWrite(RED_PIN,red||yellow);digitalWrite(GREEN_PIN,yellow);digitalWrite(BLUE_PIN,lampMode=="blue");
}
void receive(String &topic,String &payload) {
  JsonDocument p;if(deserializeJson(p,payload))return;
  if(topic.endsWith("/config")) {
    if(String(p["device_id"]|"")!=DEVICE_ID || String(p["bed_id"]|"")!=BED_ID)return;
    String next=p["id"]|"";
    if(next.length()>0 && next!=assignmentId){assignmentId=next;patientId=String(p["patient_id"]|"");encounterId=String(p["encounter_id"]|"");lampMode="off";lastCommand="";lastIssued=0;lastIssuedText="";pendingAck="";}
    return;
  }
  if(String(p["device_id"]|"")!=DEVICE_ID || String(p["bed_id"]|"")!=BED_ID || String(p["assignment_id"]|"")!=assignmentId)return;
  time_t issued=parseTime(p["issued_at"]|""), expires=parseTime(p["expires_at"]|"");
  String issuedText=p["issued_at"]|"";
  if(expires<=time(nullptr) || issued<lastIssued || (lastIssuedText.length() && issuedText.compareTo(lastIssuedText)<0))return;
  String mode=p["mode"]|"";
  if(mode!="off"&&mode!="red"&&mode!="red_blink"&&mode!="yellow"&&mode!="blue")return;
  lampMode=mode;lastIssued=issued;lastIssuedText=issuedText;lastCommand=String(p["command_id"]|"");setLamp();
  JsonDocument ack;ack["command_id"]=lastCommand;ack["device_id"]=DEVICE_ID;ack["assignment_id"]=assignmentId;ack["bed_id"]=BED_ID;ack["mode"]=lampMode;ack["status"]="applied";
  pendingAck="";serializeJson(ack,pendingAck); // Publish QoS1 outside callback to avoid nested packet processing.
}
void identity(JsonDocument &p) {
  p["schema_version"]=1;p["message_id"]=String(DEVICE_ID)+"-"+bootId+"-"+String(sequence);
  p["device_id"]=DEVICE_ID;p["device_type"]="ESP32_BEDSIDE_MONITOR";
  p["assignment_id"]=assignmentId;p["patient_id"]=patientId;p["encounter_id"]=encounterId;
  p["ward_id"]="HP";p["bed_id"]=BED_ID;p["measured_at"]=timestamp();p["sequence"]=sequence++;p["sampling_interval_ms"]=1000;
}
void reading(JsonArray readings,const char* code,const char* sensor,const char* type,float value,const char* unit,const char* source,const char* quality="valid") {
  JsonObject r=readings.add<JsonObject>();r["sensor_id"]=String(DEVICE_ID)+"-"+sensor;r["sensor_type"]=type;r["code"]=code;r["value"]=roundf(value*100)/100;r["unit"]=unit;r["quality"]=quality;r["source"]=source;
}
void telemetry() {
  if(!synchronizeClock())return;
  thermometer.requestTemperatures();float temperature=thermometer.getTempCByIndex(0);
  sensors_event_t a,g,t;float motion=0;
  if(motionReady){motionSensor.getEvent(&a,&g,&t);motion=sqrtf(a.acceleration.x*a.acceleration.x+a.acceleration.y*a.acceleration.y+a.acceleration.z*a.acceleration.z);}
  // All physiological channels below are generated test values, not measured by MPU6050/DS18B20.
  float wave=sin(sequence/7.0), pulse=78+wave*5, spo2=97+wave;
  // Potentiometer provides an interactive abnormal-condition test without pretending to be an oximeter.
  bool hypoxia=analogRead(34)>2800;if(hypoxia){spo2=87+wave;pulse=129+wave*3;}
  JsonDocument p;identity(p);JsonArray readings=p["readings"].to<JsonArray>();
  const char* quality=motion>15 ? "suspect":"valid";
  reading(readings,"pulse_rate","pulse-sim","PPG_SIMULATOR",pulse,"/min","simulated",quality);
  reading(readings,"spo2","spo2-sim","OXIMETER_SIMULATOR",spo2,"%","simulated",quality);
  bool tempValid=temperature>=0&&temperature<=60;
  reading(readings,"temperature","ds18b20","DS18B20",tempValid?temperature:0,"Cel","wokwi",tempValid?"valid":"invalid");
  reading(readings,"respiratory_rate","resp-sim","RESPIRATION_SIMULATOR",18+wave,"/min","simulated");
  reading(readings,"systolic","bp-sim","NIBP_SIMULATOR",120+wave*4,"mm[Hg]","simulated");
  reading(readings,"diastolic","bp-sim","NIBP_SIMULATOR",78+wave*2,"mm[Hg]","simulated");
  reading(readings,"weight","scale-sim","SCALE_SIMULATOR",64,"kg","simulated");
  reading(readings,"motion","mpu6050","MPU6050",motion,"m/s2","wokwi",motionReady?"valid":"invalid");
  String body;serializeJson(p,body);mqtt.publish(String("hospital/HP/devices/")+DEVICE_ID+"/telemetry",body,false,0);
  Serial.println(body);
}
void setup() {
  Serial.begin(115200);pinMode(RED_PIN,OUTPUT);pinMode(GREEN_PIN,OUTPUT);pinMode(BLUE_PIN,OUTPUT);pinMode(BUTTON_PIN,INPUT_PULLUP);pinMode(34,INPUT);
  Wire.begin(21,22);motionReady=motionSensor.begin();thermometer.begin();thermometer.setResolution(10);
  setenv("TZ","UTC0",1);tzset();bootId=String(esp_random(),HEX);
  WiFi.begin("Wokwi-GUEST","",6);
  mqtt.begin(MQTT_HOST,MQTT_PORT,network);mqtt.onMessage(receive);
  mqtt.setWill("hospital/HP/devices/" DEVICE_ID "/status","{\"online\":false}",true,1);
}
void loop() {
  setLamp();
  if(!mqtt.connected()){
    if(millis()-lastConnect>3000 && WiFi.status()==WL_CONNECTED){lastConnect=millis();if(mqtt.connect(DEVICE_ID,DEVICE_ID,MQTT_PASSWORD)){
      mqtt.subscribe(String("hospital/HP/beds/")+BED_ID+"/lamp/cmd",1);mqtt.subscribe(String("hospital/HP/devices/")+DEVICE_ID+"/config",1);
      mqtt.publish(String("hospital/HP/devices/")+DEVICE_ID+"/status","{\"online\":true}",true,1);
    }}delay(5);return;
  }
  mqtt.loop();
  if(pendingAck.length() && mqtt.publish(String("hospital/HP/beds/")+BED_ID+"/lamp/ack",pendingAck,false,1)){pendingAck="";Serial.println("ACTUATOR ACK "+lampMode+" "+lastCommand);}
  bool button=digitalRead(BUTTON_PIN);
  if(button==LOW&&previousButton==HIGH&&millis()-lastPress>300){lastPress=millis();if(synchronizeClock()){JsonDocument p;identity(p);p["event"]="nurse_call";String body;serializeJson(p,body);mqtt.publish(String("hospital/HP/devices/")+DEVICE_ID+"/event",body,false,1);}}
  previousButton=button;
  if(millis()-lastSample>=1000){lastSample=millis();telemetry();}
  delay(5);
}
