import numpy as np
import cv2
import subprocess
import select
import re
import json

cap = cv2.VideoCapture(0)

proc = None

frame = None
annotated = None
while(True):
    if proc is None:
        proc = subprocess.Popen(['node', 'ga_peoplecount.js'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        poller = select.poll()
        poller.register(proc.stdout)

    detections = []
    if poller is not None:
        if poller.poll(20):
            line = proc.stdout.readline()
            try:
                detections = json.loads(line)
                print(detections)
                if frame is not None:
                    width = frame.shape[1]
                    height = frame.shape[0]
                    annotated = frame.copy()
                    for detection in detections:
                        if detection['label'] == "head":
                            box = detection['bbox']
                            cv2.rectangle(
                                annotated,
                                (box['x'] * width, box['y'] * height),
                                (box['width'] * width, box['height'] * height),
                                (0, 0, 255),
                                1
                            )
            except ValueError as e:
                print(line)

    ret, frame = cap.read()
    if annotated is not None:
        cv2.imshow('frame', annotated)
    else:
        if frame is not None:
            cv2.imshow('frame', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# When everything done, release the capture
cap.release()
cv2.destroyAllWindows()

