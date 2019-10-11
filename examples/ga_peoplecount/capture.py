import numpy as np
import cv2
import subprocess
import select
import re

cap = cv2.VideoCapture(0)

n = None
        
while(True):
    if n is None:
        n = subprocess.Popen(['node', 'ga_peoplecount.js'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        p = select.poll()
        p.register(n.stdout)

    if p is not None:
        if p.poll(1000):
            line = n.stdout.readline()
            print(line.decode("utf-8"))

    # Capture frame-by-frame
    ret, frame = cap.read()

    # Our operations on the frame come here
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Display the resulting frame
    cv2.imshow('frame', gray)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# When everything done, release the capture
cap.release()
cv2.destroyAllWindows()

