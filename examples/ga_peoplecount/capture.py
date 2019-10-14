import numpy as np
import cv2
import subprocess
import select
import re
import json

cap = cv2.VideoCapture(2)

proc = None

while (True):
    if proc is None:
        proc = subprocess.Popen(['node', 'ga_peoplecount.js'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    if proc is not None:
        res = proc.stdout.peek()
        if res:
            line = proc.stdout.readline()
            try:
                json_object = json.loads(line)
                print(json_object)
            except ValueError as e:
                print(line)

    # Capture frame-by-frame
    ret, frame = cap.read()

    # Our operations on the frame come here
    if frame is not None:
        cv2.imshow('frame', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# When everything done, release the capture
cap.release()
cv2.destroyAllWindows()

