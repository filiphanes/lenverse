cd server; bash build.sh; cd ..
#exit
#cd apps/resolume; bash build.sh; cd ../..

zip -r lenverse-$(date "+%Y-%m-%d").zip \
    bin/ \
    www/ \
    README.md \
