package com.somtel.driver.core

import com.somtel.driver.core.model.AppJson
import com.somtel.driver.core.model.Job

object Fixtures {
    /** Sample taken from docs/API.md (with comments/unions resolved). */
    const val JOB_JSON = """
    {
      "id": 101, "reference": "JOB-000101",
      "title": "Deliver 40 cartons", "description": "", "priority": "high",
      "status": "assigned",
      "deviceId": 4, "driverId": 2,
      "customerName": "Hodan", "customerPhone": "+252 61 555 0101",
      "scheduledStart": "2026-10-24T06:00:00Z", "dueBy": "2026-10-24T09:30:00Z",
      "stops": [
        { "id": 1, "seq": 1, "name": "Warehouse", "address": "", "lat": 2.04, "lng": 45.31, "radius": 150,
          "status": "pending", "arrivedAt": null, "departedAt": null, "completedAt": null, "notes": "" },
        { "id": 2, "seq": 2, "name": "Shop", "address": "Maka Al Mukarama", "lat": 2.05, "lng": 45.32, "radius": 99.5,
          "status": "pending", "arrivedAt": null, "departedAt": null, "completedAt": null, "notes": "" }
      ],
      "checklist": [
        { "id": 1, "text": "Check seal", "required": true, "done": false, "doneAt": null },
        { "id": 2, "text": "Photo of load", "required": false, "done": false, "doneAt": null }
      ],
      "attachments": [ { "id": 9, "kind": "photo", "stopId": 1, "url": "/api/v1/files/9", "name": "pod.jpg", "createdAt": "2026-10-24T07:00:00Z" } ],
      "notes": "", "failureReason": "",
      "createdBy": 1, "createdAt": "2026-10-23T10:00:00Z", "updatedAt": "2026-10-23T10:00:00Z", "completedAt": null,
      "routeId": null,
      "someFutureField": {"x": 1}
    }
    """

    fun job(): Job = AppJson.decodeFromString(Job.serializer(), JOB_JSON)
}
